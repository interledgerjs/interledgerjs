/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-empty-function */
import { Int, isNonNegativeRational, sleep } from './utils'
import fetch, { Response } from 'node-fetch'
import { PaymentError, SetupOptions } from '.'
import createLogger from 'ilp-logger'
import { AssetDetails, isValidAssetScale, isValidAssetDetails } from './controllers/asset-details'
import { IlpAddress, isValidIlpAddress } from 'ilp-packet'
import AbortController from 'abort-controller'
import { AccountUrl, createHttpUrl } from './payment-pointer'

const SHARED_SECRET_BYTE_LENGTH = 32
const INCOMING_PAYMENT_QUERY_ACCEPT_HEADER = 'application/json'
const ACCOUNT_QUERY_ACCEPT_HEADER = 'application/ilp-stream+json, application/spsp4+json'

const log = createLogger('ilp-pay:query')

/**
 * Destination details of the payment, such the asset, Incoming Payment, and STREAM credentials to
 * establish an authenticated connection with the receiver
 */
export interface PaymentDestination {
  /** 32-byte seed to derive keys to encrypt STREAM messages and generate ILP packet fulfillments */
  sharedSecret: Buffer
  /** ILP address of the recipient, identifying this connection, which is used to send packets to their STREAM server */
  destinationAddress: IlpAddress
  /** Asset and denomination of the receiver's Interledger account */
  destinationAsset?: AssetDetails
  /** Open Payments v2 Incoming Payment metadata, if the payment pays into an Incoming Payment */
  receivingPaymentDetails?: IncomingPayment
  /**
   * URL of the recipient Open Payments/SPSP account (with well-known path, and stripped trailing slash).
   * Each payment pointer and its corresponding account URL identifies a unique payment recipient.
   * Not applicable if STREAM credentials were provided directly.
   */
  accountUrl?: string
  /**
   * Payment pointer, prefixed with "$", corresponding to the recipient Open Payments/SPSP account.
   * Each payment pointer and its corresponding account URL identifies a unique payment recipient.
   * Not applicable if STREAM credentials were provided directly.
   */
  receivingAccount?: string
}

/** [Open Payments v2 Incoming Payment](https://docs.openpayments.guide) metadata */
export interface IncomingPayment {
  /** URL identifying the Incoming Payment */
  id: string
  /** URL identifying the account into which payments toward the Incoming Payment will be credited */
  accountId: string
  /** State of the Incoming Payment */
  state: IncomingPaymentState
  /** UNIX timestamp in milliseconds when payments toward the Incoming Payment will no longer be accepted */
  expiresAt?: number
  /** Human-readable description of the Incoming Payment */
  description?: string
  /** Human-readable external reference of the Incoming Payment */
  externalRef?: string
  /** Fixed destination amount that must be delivered to complete payment of the Incoming Payment. */
  incomingAmount: Amount
  /** Amount that has already been paid toward the Incoming Payment. */
  receivedAmount: Amount
  /** Flag whether STREAM receipts will be provided. */
  receiptsEnabled: boolean
}

interface Amount {
  // Amount, in base units. ≥0
  amount: bigint
  /** Asset code or symbol identifying the currency of the account */
  assetCode: string
  /** Precision of the asset denomination: number of decimal places of the normal unit */
  assetScale: number
}

export enum IncomingPaymentState {
  // The payment has a state of `pending` when it is initially created.
  Pending = 'pending',
  // As soon as payment has started (funds have cleared into the account) the state moves to `processing`.
  Processing = 'processing',
  // The payment is either auto-completed once the received amount equals the expected amount `amount`,
  // or it is completed manually via an API call.
  Completed = 'completed',
  // If the payment expires before it is completed then the state will move to `expired`
  // and no further payments will be accepted.
  Expired = 'expired',
}

/** Validate and resolve the details provided by recipient to execute the payment */
export const fetchPaymentDetails = async (
  options: Partial<SetupOptions>
): Promise<PaymentDestination | PaymentError> => {
  const {
    receivingPayment,
    receivingAccount,
    sharedSecret,
    destinationAddress,
    destinationAsset,
  } = options

  // Resolve Incoming Payment and STREAM credentials
  if (receivingPayment) {
    return queryPayment(receivingPayment)
  }
  // Resolve STREAM credentials from a payment pointer or account URL via Open Payments or SPSP
  else if (receivingAccount) {
    return queryAccount(receivingAccount)
  }
  // STREAM credentials were provided directly
  else if (
    isSharedSecretBuffer(sharedSecret) &&
    isValidIlpAddress(destinationAddress) &&
    (!destinationAsset || isValidAssetDetails(destinationAsset))
  ) {
    log.warn(
      'using custom STREAM credentials. receivingPayment or receivingAccount are recommended to setup a STREAM payment'
    )
    return {
      sharedSecret,
      destinationAddress,
      destinationAsset,
    }
  }
  // No STREAM credentials or method to resolve them
  else {
    log.debug(
      'invalid config: no receivingAccount, receivingPayment, or stream credentials provided'
    )
    return PaymentError.InvalidCredentials
  }
}

/** Fetch an Incoming Payment and STREAM credentials from an Open Payments */
const queryPayment = async (url: string): Promise<PaymentDestination | PaymentError> => {
  if (!createHttpUrl(url)) {
    log.debug('receivingPayment query failed: URL not HTTP/HTTPS.')
    return PaymentError.QueryFailed
  }

  return fetchJson(url, INCOMING_PAYMENT_QUERY_ACCEPT_HEADER)
    .then(async (data) => {
      const credentials = validateOpenPaymentsCredentials(data)
      const incomingPayment = validateOpenPaymentsIncomingPayment(data, url)

      if (incomingPayment && credentials) {
        return {
          accountUrl: incomingPayment.accountId,
          receivingPaymentDetails: incomingPayment,
          ...credentials,
        }
      }
      log.debug('receivingPayment query returned an invalid response.')
    })
    .catch((err) => log.debug('receivingPayment query failed.', err?.message))
    .then((res) => res || PaymentError.QueryFailed)
}

/** Query the payment pointer, Open Payments server, or SPSP server for credentials to establish a STREAM connection */
export const queryAccount = async (
  receivingAccount: string
): Promise<PaymentDestination | PaymentError> => {
  const accountUrl =
    AccountUrl.fromPaymentPointer(receivingAccount) ?? AccountUrl.fromUrl(receivingAccount)
  if (!accountUrl) {
    log.debug('payment pointer or account url is invalid: %s', receivingAccount)
    return PaymentError.InvalidPaymentPointer
  }

  return fetchJson(accountUrl.toEndpointUrl(), ACCOUNT_QUERY_ACCEPT_HEADER)
    .then(
      (data) =>
        validateOpenPaymentsCredentials(data) ??
        validateSpspCredentials(data) ??
        log.debug('payment pointer query returned no valid STREAM credentials.')
    )
    .catch((err) => log.debug('payment pointer query failed: %s', err))
    .then((res) =>
      res
        ? {
            ...res,
            accountUrl: accountUrl.toString(),
            receivingAccount: accountUrl.toPaymentPointer(),
          }
        : PaymentError.QueryFailed
    )
}

/** Perform an HTTP request using `fetch` with timeout and retries. Resolve with parsed JSON, reject otherwise. */
const fetchJson = async (
  url: string,
  acceptHeader: string,
  timeout = 3000,
  remainingRetries = [10, 500, 2500] // Retry up to 3 times with increasing backoff
): Promise<any> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  const retryDelay = remainingRetries.shift()

  return fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: acceptHeader,
    },
    signal: controller.signal,
  })
    .then(
      async (res: Response) => {
        // If server error, retry after delay
        if ((res.status >= 500 || res.status === 429) && retryDelay) {
          await sleep(retryDelay)
          return fetchJson(url, acceptHeader, timeout, remainingRetries)
        }

        // Parse JSON on HTTP 2xx, otherwise error
        return res.ok ? res.json() : Promise.reject()
      },
      async (err: Error) => {
        // Only handle timeout (abort) errors. Use two `then` callbacks instead
        // of then/catch so JSON parsing errors, etc. are not caught here.
        if (err.name !== 'AbortError' && retryDelay) {
          await sleep(retryDelay)
          return fetchJson(url, acceptHeader, timeout, remainingRetries)
        }

        throw err
      }
    )
    .finally(() => clearTimeout(timer))
}

const validateSharedSecretBase64 = (o: any): Buffer | undefined => {
  if (typeof o === 'string') {
    const sharedSecret = Buffer.from(o, 'base64')
    if (sharedSecret.byteLength === SHARED_SECRET_BYTE_LENGTH) {
      return sharedSecret
    }
  }
}

const isSharedSecretBuffer = (o: any): o is Buffer =>
  Buffer.isBuffer(o) && o.byteLength === SHARED_SECRET_BYTE_LENGTH

/** Validate the input is a number or string in the range of a u64 integer, and transform into `Int` */
const validateUInt64 = (o: any): Int | undefined => {
  if (!['string', 'number'].includes(typeof o)) {
    return
  }

  const n = Int.from(o)
  if (n?.isLessThanOrEqualTo(Int.MAX_U64)) {
    return n
  }
}

const isNonNullObject = (o: any): o is Record<string, any> => typeof o === 'object' && o !== null

/** Transform the Open Payments server reponse into a validated IncomingPayment */
const validateOpenPaymentsIncomingPayment = (
  o: any,
  queryUrl: string
): IncomingPayment | undefined => {
  if (!isNonNullObject(o)) {
    return
  }

  const {
    accountId,
    state,
    incomingAmount: unvalidatedIncomingAmount,
    receivedAmount: unvalidatedReceivedAmount,
    expiresAt: expiresAtIso,
    description,
    externalRef,
    receiptsEnabled,
  } = o
  const expiresAt = expiresAtIso ? Date.parse(expiresAtIso) : undefined // `NaN` if date is invalid
  const incomingAmount = validateOpenPaymentsAmount(unvalidatedIncomingAmount)
  const receivedAmount = validateOpenPaymentsAmount(unvalidatedReceivedAmount)

  if (
    typeof accountId !== 'string' ||
    !(typeof description === 'string' || description === undefined) ||
    !(typeof externalRef === 'string' || externalRef === undefined) ||
    typeof receiptsEnabled !== 'boolean' ||
    !(isNonNegativeRational(expiresAt) || expiresAt === undefined) ||
    !incomingAmount ||
    !receivedAmount
  ) {
    return
  }

  const accountUrl = AccountUrl.fromUrl(accountId)
  if (!accountUrl) return

  if (state! in IncomingPaymentState) return

  // TODO Should the given Incoming Payment URL be validated against the `id` URL in the Incoming Payment itself?

  return {
    id: queryUrl,
    accountId: accountUrl.toEndpointUrl(),
    state,
    expiresAt,
    description,
    externalRef,
    receivedAmount,
    incomingAmount,
    receiptsEnabled,
  }
}

/** Validate Open Payments STREAM credentials and asset details */
const validateOpenPaymentsCredentials = (o: any): PaymentDestination | undefined => {
  if (!isNonNullObject(o)) {
    return
  }

  const { sharedSecret: sharedSecretBase64, ilpAddress: destinationAddress, incomingAmount } = o
  if (!incomingAmount) return
  const sharedSecret = validateSharedSecretBase64(sharedSecretBase64)
  const destinationAmount = validateOpenPaymentsAmount(incomingAmount)
  if (!sharedSecret || !isValidIlpAddress(destinationAddress) || !destinationAmount) {
    return
  }

  return {
    destinationAsset: { code: destinationAmount.assetCode, scale: destinationAmount.assetScale },
    destinationAddress,
    sharedSecret,
  }
}

/** Validate and transform the SPSP server response into STREAM credentials */
const validateSpspCredentials = (o: any): PaymentDestination | undefined => {
  if (!isNonNullObject(o)) {
    return
  }

  const { destination_account: destinationAddress, shared_secret } = o
  const sharedSecret = validateSharedSecretBase64(shared_secret)
  if (sharedSecret && isValidIlpAddress(destinationAddress)) {
    return { destinationAddress, sharedSecret }
  }
}

const validateOpenPaymentsAmount = (o: Record<string, any>): Amount | undefined => {
  const { amount, assetScale, assetCode } = o
  const amountInt = validateUInt64(amount)
  if (amountInt && isValidAssetScale(assetScale) && typeof assetCode === 'string') {
    return { amount: amountInt.value, assetCode, assetScale }
  }
}
