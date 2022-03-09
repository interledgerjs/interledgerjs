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
 * Destination details of the payment, such the asset, incoming payment, and STREAM credentials to
 * establish an authenticated connection with the receiver
 */
export interface PaymentDestination {
  /** 32-byte seed to derive keys to encrypt STREAM messages and generate ILP packet fulfillments */
  sharedSecret: Buffer
  /** ILP address of the recipient, identifying this connection, which is used to send packets to their STREAM server */
  destinationAddress: IlpAddress
  /** Asset and denomination of the receiver's Interledger account */
  destinationAsset?: AssetDetails
  /** Open Payments v2 incoming payment metadata, if the payment pays into an incoming payment */
  incomingPayment?: IncomingPayment
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
  paymentPointer?: string
}

/** [Open Payments v2 incoming payment](https://docs.openpayments.guide) metadata */
export interface IncomingPayment {
  /** URL identifying the incoming payment */
  incomingPaymentUrl: string
  /** URL identifying the account into which payments toward the incoming payment will be credited */
  accountUrl: string
  /** State of the incoming payment */
  state: IncomingPaymentState
  /** UNIX timestamp in milliseconds when payments toward the incoming payment will no longer be accepted */
  expiresAt: number
  /** Human-readable description of the incoming payment */
  description: string
  /** Human-readable external reference of the incoming payment */
  externalRef: string
  /** Fixed destination amount that must be delivered to complete payment of the incoming payment, in base units. ≥0 */
  amountToDeliver: bigint
  /** Amount that has already been paid toward the incoming payment, in base units. >0 */
  amountDelivered: bigint
  /** Asset and denomination of recipient account */
  asset: AssetDetails
  /** Flag whether STREAM receipts should be enabled */
  receiptsEnabled: boolean
}

export enum IncomingPaymentState {
  // The payment has a state of `PENDING` when it is initially created.
  Pending = 'PENDING',
  // As soon as payment has started (funds have cleared into the account) the state moves to `PROCESSING`.
  Processing = 'PROCESSING',
  // The payment is either auto-completed once the received amount equals the expected amount `amount`,
  // or it is completed manually via an API call.
  Completed = 'COMPLETED',
  // If the payment expires before it is completed then the state will move to `EXPIRED`
  // and no further payments will be accepted.
  Expired = 'EXPIRED',
}

/** Validate and resolve the details provided by recipient to execute the payment */
export const fetchPaymentDetails = async (
  options: Partial<SetupOptions>
): Promise<PaymentDestination | PaymentError> => {
  const {
    incomingPaymentUrl,
    paymentPointer,
    sharedSecret,
    destinationAddress,
    destinationAsset,
  } = options

  // Resolve incoming payment and STREAM credentials
  if (incomingPaymentUrl) {
    return queryIncomingPayment(incomingPaymentUrl)
  }
  // Resolve STREAM credentials from a payment pointer or account URL via Open Payments or SPSP
  else if (paymentPointer) {
    return queryAccount(paymentPointer)
  }
  // STREAM credentials were provided directly
  else if (
    isSharedSecretBuffer(sharedSecret) &&
    isValidIlpAddress(destinationAddress) &&
    (!destinationAsset || isValidAssetDetails(destinationAsset))
  ) {
    log.warn(
      'using custom STREAM credentials. incoming payment or payment pointer is recommended to setup a STREAM payment'
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
      'invalid config: no incoming payment, incoming payment, payment pointer, or stream credentials provided'
    )
    return PaymentError.InvalidCredentials
  }
}

/** Fetch an incoming payment and STREAM credentials from an Open Payments */
const queryIncomingPayment = async (url: string): Promise<PaymentDestination | PaymentError> => {
  if (!createHttpUrl(url)) {
    log.debug('incoming payment query failed: URL not HTTP/HTTPS.')
    return PaymentError.QueryFailed
  }

  return fetchJson(url, INCOMING_PAYMENT_QUERY_ACCEPT_HEADER)
    .then(async (data) => {
      const credentials = validateOpenPaymentsCredentials(data)
      const incomingPayment = validateOpenPaymentsIncomingPayment(data, url)

      if (incomingPayment && credentials) {
        return {
          accountUrl: incomingPayment.accountUrl,
          incomingPayment,
          ...credentials,
        }
      }
      log.debug('incoming payment query returned an invalid response.')
    })
    .catch((err) => log.debug('incoming payment query failed.', err?.message))
    .then((res) => res || PaymentError.QueryFailed)
}

/** Query the payment pointer, Open Payments server, or SPSP server for credentials to establish a STREAM connection */
export const queryAccount = async (
  paymentPointer: string
): Promise<PaymentDestination | PaymentError> => {
  const accountUrl =
    AccountUrl.fromPaymentPointer(paymentPointer) ?? AccountUrl.fromUrl(paymentPointer)
  if (!accountUrl) {
    log.debug('payment pointer or account url is invalid: %s', paymentPointer)
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
            paymentPointer: accountUrl.toPaymentPointer(),
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

/** Transform the Open Payments server reponse into a validated incoming payment */
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
    incomingAmount,
    receivedAmount,
    expiresAt: expiresAtIso,
    description,
    externalRef,
    receiptsEnabled,
  } = o
  const expiresAt = Date.parse(expiresAtIso) // `NaN` if date is invalid
  const amountToDeliver = validateUInt64(incomingAmount.amount)
  const amountDelivered = validateUInt64(receivedAmount.amount)
  const assetToDeliver = validateOpenPaymentsAsset(incomingAmount)
  const assetDelivered = validateOpenPaymentsAsset(receivedAmount)

  if (
    typeof accountId !== 'string' ||
    typeof description !== 'string' ||
    typeof externalRef !== 'string' ||
    typeof receiptsEnabled !== 'boolean' ||
    !isNonNegativeRational(expiresAt) ||
    !amountToDeliver ||
    !amountToDeliver.isPositive() ||
    !amountDelivered ||
    !assetToDeliver ||
    !assetDelivered
  ) {
    return
  }

  const accountUrl = AccountUrl.fromUrl(accountId)
  if (!accountUrl) return

  if (state! in IncomingPaymentState) return

  // TODO Should the given incoming payment URL be validated against the `id` URL in the incoming payment itself?

  return {
    incomingPaymentUrl: queryUrl,
    accountUrl: accountUrl.toEndpointUrl(),
    state,
    expiresAt,
    description,
    externalRef,
    amountDelivered: amountDelivered.value,
    amountToDeliver: amountToDeliver.value,
    asset: assetToDeliver,
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
  const destinationAsset = validateOpenPaymentsAsset(incomingAmount)
  if (!sharedSecret || !isValidIlpAddress(destinationAddress) || !destinationAsset) {
    return
  }

  return {
    destinationAsset,
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

const validateOpenPaymentsAsset = (o: Record<string, any>): AssetDetails | undefined => {
  const { assetScale, assetCode } = o
  if (isValidAssetScale(assetScale) && typeof assetCode === 'string') {
    return { code: assetCode, scale: assetScale }
  }
}
