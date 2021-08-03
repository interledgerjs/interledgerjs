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
const INVOICE_QUERY_ACCEPT_HEADER = 'application/ilp-stream+json'
const ACCOUNT_QUERY_ACCEPT_HEADER = 'application/ilp-stream+json, application/spsp4+json'

const log = createLogger('ilp-pay:query')

/**
 * Destination details of the payment, such the asset, invoice, and STREAM credentials to
 * establish an authenticated connection with the receiver
 */
export interface PaymentDestination {
  /** 32-byte seed to derive keys to encrypt STREAM messages and generate ILP packet fulfillments */
  sharedSecret: Buffer
  /** ILP address of the recipient, identifying this connection, which is used to send packets to their STREAM server */
  destinationAddress: IlpAddress
  /** Asset and denomination of the receiver's Interledger account */
  destinationAsset?: AssetDetails
  /** Open Payments invoice metadata, if the payment pays into an invoice */
  invoice?: Invoice
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

/** [Open Payments invoice](https://docs.openpayments.dev/invoices) metadata */
export interface Invoice {
  /** URL identifying the invoice */
  invoiceUrl: string
  /** URL identifying the account into which payments toward the invoice will be credited */
  accountUrl: string
  /** UNIX timestamp in milliseconds when payments toward the invoice will no longer be accepted */
  expiresAt: number
  /** Human-readable description of the invoice */
  description: string
  /** Fixed destination amount that must be delivered to complete payment of the invoice, in base units. ≥0 */
  amountToDeliver: bigint
  /** Amount that has already been paid toward the invoice, in base units. >0 */
  amountDelivered: bigint
  /** Asset and denomination of recipient account */
  asset: AssetDetails
}

/** Validate and resolve the details provided by recipient to execute the payment */
export const fetchPaymentDetails = async (
  options: Partial<SetupOptions>
): Promise<PaymentDestination | PaymentError> => {
  const { invoiceUrl, paymentPointer, sharedSecret, destinationAddress, destinationAsset } = options
  // Resolve invoice and STREAM credentials
  if (invoiceUrl) {
    return queryInvoice(invoiceUrl)
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
      'using custom STREAM credentials. invoice or payment pointer is recommended to setup a STREAM payment'
    )
    return {
      sharedSecret,
      destinationAddress,
      destinationAsset,
    }
  }
  // No STREAM credentials or method to resolve them
  else {
    log.debug('invalid config: no invoice, payment pointer, or stream credentials provided')
    return PaymentError.InvalidCredentials
  }
}

/** Fetch an invoice and STREAM credentials from an Open Payments */
const queryInvoice = async (invoiceUrl: string): Promise<PaymentDestination | PaymentError> => {
  if (!createHttpUrl(invoiceUrl)) {
    log.debug('invoice query failed: invoice URL not HTTP/HTTPS.')
    return PaymentError.QueryFailed
  }

  return fetchJson(invoiceUrl, INVOICE_QUERY_ACCEPT_HEADER)
    .then(async (data) => {
      const invoice = validateOpenPaymentsInvoice(data, invoiceUrl)
      const credentials = validateOpenPaymentsCredentials(data)
      if (invoice && credentials) {
        return {
          accountUrl: invoice.accountUrl,
          invoice,
          ...credentials,
        }
      }

      log.debug('invoice query returned an invalid response.')
    })
    .catch((err) => log.debug('invoice query failed.', err?.message))
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

/** Transform the Open Payments server reponse into a validated invoice */
const validateOpenPaymentsInvoice = (o: any, queryUrl: string): Invoice | undefined => {
  if (!isNonNullObject(o)) {
    return
  }

  const { expiresAt: expiresAtIso, account, description, amount, received } = o
  const expiresAt = Date.parse(expiresAtIso) // `NaN` if date is invalid
  const amountToDeliver = validateUInt64(amount)
  const amountDelivered = validateUInt64(received)
  const asset = validateOpenPaymentsAsset(o)

  if (
    typeof account !== 'string' ||
    typeof description !== 'string' ||
    !isNonNegativeRational(expiresAt) ||
    !amountToDeliver ||
    !amountToDeliver.isPositive() ||
    !amountDelivered ||
    !asset
  ) {
    return
  }

  const accountUrl = AccountUrl.fromUrl(account)
  // The base url has no query string, fragment, or trailing slash
  const invoiceBaseUrl = accountUrl && accountUrl.toBaseUrl() + '/invoices' // Safe to append directly

  if (
    !accountUrl ||
    !invoiceBaseUrl ||
    !queryUrl.startsWith(invoiceBaseUrl) // Validates invoice is a subresource of this OP account
  ) {
    return
  }

  // TODO Should the given invoice URL be validated against the `id` URL in the invoice itself?

  return {
    invoiceUrl: queryUrl,
    accountUrl: accountUrl.toEndpointUrl(),
    expiresAt,
    description,
    amountDelivered: amountDelivered.value,
    amountToDeliver: amountToDeliver.value,
    asset,
  }
}

/** Validate Open Payments STREAM credentials and asset details */
const validateOpenPaymentsCredentials = (o: any): PaymentDestination | undefined => {
  if (!isNonNullObject(o)) {
    return
  }

  const { sharedSecret: sharedSecretBase64, ilpAddress: destinationAddress } = o
  const sharedSecret = validateSharedSecretBase64(sharedSecretBase64)
  const destinationAsset = validateOpenPaymentsAsset(o)
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
