/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-empty-function */
import { IlpAddress, isValidAssetScale, isValidIlpAddress } from './utils'
import { Int, NonNegativeNumber, isNonNegativeNumber, PositiveInt } from './utils'
import Axios from 'axios'
import { PaymentError, PaymentOptions } from '.'
import createLogger from 'ilp-logger'
import { AssetDetails } from './controllers/asset-details'

const log = createLogger('ilp-pay')

/** STREAM credentials necessary to establish an authenticated connection with the receiver */
export interface StreamCredentials {
  /** 32-byte symmetric key to encrypt and decrypt STREAM messages, and generate ILP packet fulfillments */
  sharedSecret: Buffer
  /** ILP address of the recipient, identifying this connection, which is used to send packets to their STREAM server */
  destinationAddress: IlpAddress
  /** Asset and denomination of the receiver's Interledger account */
  destinationAsset?: AssetDetails
}

/** Validated metadata from an Open Payments invoice */
export interface OpenPaymentsInvoice {
  /** Amount in base destination units that has already been paid towards the invoice */
  amountDelivered: Int
  /** Minimum amount in base destination units that must be delivered in order to complete the invoice */
  amountToDeliver: PositiveInt
  /** URL identifying the invoice */
  invoiceUrl: string
  /** URL identifying the account into which payments toward the invoice will be credited */
  accountUrl: string
  /** UNIX timestamp in milliseconds when payments toward the invoice will no longer be accepted */
  expiresAt: NonNegativeNumber
  /** Human-readable description of the invoice */
  description: string
}

/** Payment details provided by the recipient, including their asset, ILP address, STREAM shared secret, and/or invoice */
export interface PaymentDetails extends StreamCredentials {
  invoice?: OpenPaymentsInvoice
}

/** Validate and resolve the details provided by recipient to execute the payment */
export const fetchPaymentDetails = async (
  options: Partial<PaymentOptions>
): Promise<PaymentDetails | PaymentError> => {
  // Resolve invoice and STREAM credentials
  if (options.invoiceUrl) {
    return queryInvoice(options.invoiceUrl)
  }
  // Resolve STREAM credentials from a payment pointer or account URL via Open Payments or SPSP
  else if (options.paymentPointer) {
    return queryAccount(options.paymentPointer)
  }
  // STREAM credentials were provided directly
  else if (isStreamCredentials(options)) {
    log.warn(
      'sharedSecret/destinationAddress are for testing. invoice or payment pointer is recommended to setup STREAM payment'
    )
    return options
  }
  // No STREAM credentials
  else {
    log.debug('invalid config: shared secret or destination address missing or invalid')
    return PaymentError.InvalidCredentials
  }
}

/** Fetch an invoice and STREAM credentials from an Open Payments */
const queryInvoice = async (invoiceUrl: string): Promise<PaymentDetails | PaymentError> =>
  Axios.get(invoiceUrl, {
    timeout: 5000,
    headers: {
      Accept: 'application/ilp-stream+json', // Also include STREAM credentials
    },
  })
    .then(({ data }) => {
      const invoice = validateOpenPaymentsInvoice(data)
      const credentials = validateOpenPaymentsCredentials(data)
      if (invoice && credentials) {
        return {
          invoice,
          ...credentials,
        }
      } else {
        log.debug('invoice query returned an invalid response.')
        return PaymentError.QueryFailed
      }
    })
    .catch((err) => {
      log.debug('invoice query failed: %s', err) // Stringify, since Axios errors are verbose
      return PaymentError.QueryFailed
    })

/** Query the payment pointer, Open Payments server, or SPSP server for credentials to establish a STREAM connection */
const queryAccount = async (paymentPointer: string): Promise<PaymentDetails | PaymentError> => {
  const accountUrls = parsePaymentPointer(paymentPointer)
  if (!accountUrls) {
    log.debug('payment pointer or account url is invalid: %s', paymentPointer)
    return PaymentError.InvalidPaymentPointer
  }

  const { token, cancel } = Axios.CancelToken.source()

  // Perform SPSP & Open Payments queries in parallel
  const requests = accountUrls.map((url) =>
    Axios.get(url, {
      timeout: 5000,
      headers: {
        Accept: 'application/ilp-stream+json, application/spsp4+json',
      },
      cancelToken: token,
    })
      .then(async ({ data }) => {
        const credentials = validateOpenPaymentsCredentials(data) ?? validateSpspCredentials(data)
        if (credentials) {
          return credentials
        }

        log.debug('payment pointer query returned no valid STREAM credentials.')
      })
      .catch((err) => {
        log.debug('payment pointer query failed: %s', err)
      })
  )

  const result = await Promise.race([
    somePromise(requests), // First success
    noPromises(requests), // All requests failed
  ])

  cancel() // Cancel the other pending request
  return result || PaymentError.QueryFailed
}

const SHARED_SECRET_BYTE_LENGTH = 32

const validateSharedSecretBase64 = (o: any): Buffer | void => {
  if (typeof o === 'string') {
    const sharedSecret = Buffer.from(o, 'base64')
    if (sharedSecret.byteLength === SHARED_SECRET_BYTE_LENGTH) {
      return sharedSecret
    }
  }
}

const isSharedSecretBuffer = (o: any): o is Buffer =>
  Buffer.isBuffer(o) && o.byteLength === SHARED_SECRET_BYTE_LENGTH

/** Validate and convert a payment pointer into account URLs for an Open Payments & SPSP server */
const parsePaymentPointer = (pointer: string): string[] | undefined => {
  try {
    const endpoint = new URL(pointer.startsWith('$') ? 'https://' + pointer.substring(1) : pointer)
    if (endpoint.pathname === '/') {
      endpoint.pathname = '/.well-known/open-payments'
      const openPaymentsUrl = endpoint.href

      endpoint.pathname = '/.well-known/pay'
      const spspUrl = endpoint.href

      return [openPaymentsUrl, spspUrl]
    } else {
      return [endpoint.href]
    }
  } catch (_) {
    // No-op if the URL is invalid
  }
}

/** Validate the input is a number or string in the range of a u64 integer, and transform into `Int` */
const validateUInt64 = (o: any): Int | void => {
  const n = Int.from(o)
  if (n?.isLessThanOrEqualTo(Int.MAX_U64)) {
    return n
  }
}

/** Transform the Open Payments server reponse into a validated invoice */
const validateOpenPaymentsInvoice = (o: any): OpenPaymentsInvoice | void => {
  if (typeof o !== 'object' || o === null) {
    return
  }

  const {
    id: invoiceUrl,
    account: accountUrl,
    expiresAt: expiresAtIso,
    description,
    amount,
    received,
  } = o
  const expiresAt = Date.parse(expiresAtIso) // `NaN` if date is invalid

  if (
    typeof invoiceUrl !== 'string' ||
    typeof accountUrl !== 'string' ||
    typeof description !== 'string' ||
    !['string', 'number'].includes(typeof amount) ||
    !['string', 'number'].includes(typeof received) ||
    !isNonNegativeNumber(expiresAt)
  ) {
    return
  }

  const amountToDeliver = validateUInt64(amount)
  const amountDelivered = validateUInt64(received)
  if (!amountToDeliver || !amountToDeliver.isPositive() || !amountDelivered) {
    return
  }

  return {
    invoiceUrl,
    accountUrl,
    expiresAt,
    description,
    amountDelivered,
    amountToDeliver,
  }
}

/** Validate Open Payments STREAM credentials and asset details */
const validateOpenPaymentsCredentials = (o: any): StreamCredentials | void => {
  if (typeof o !== 'object' || o === null) {
    return
  }

  const { sharedSecret: sharedSecretBase64, ilpAddress: destinationAddress } = o
  const sharedSecret = validateSharedSecretBase64(sharedSecretBase64)
  if (!sharedSecret || !isValidIlpAddress(destinationAddress)) {
    return
  }

  const { assetScale, assetCode } = o
  if (isValidAssetScale(assetScale) && typeof assetCode === 'string') {
    return {
      destinationAsset: {
        assetCode,
        assetScale,
      },
      destinationAddress,
      sharedSecret,
    }
  }
}

/** Is the input valid STREAM credentials? */
const isStreamCredentials = (o: any): o is StreamCredentials =>
  typeof o === 'object' &&
  o !== null &&
  isValidIlpAddress(o.destinationAddress) &&
  isSharedSecretBuffer(o.sharedSecret)

/** Validate and transform the SPSP server response into STREAM credentials */
const validateSpspCredentials = (o: any): StreamCredentials | void => {
  if (typeof o !== 'object' || o === null) {
    return
  }

  const { destination_account: destinationAddress, shared_secret } = o
  const sharedSecret = validateSharedSecretBase64(shared_secret)
  if (sharedSecret && isValidIlpAddress(destinationAddress)) {
    return { destinationAddress, sharedSecret }
  }
}

/** Resolve when some Promise resolves to a truthy value. Otherwise, never settle. */
const somePromise = async <T>(promises: Promise<T>[]): Promise<T> =>
  new Promise((resolve) => {
    promises.forEach((p) => {
      p.then((value) => !!value && resolve(value))
    })
  })

/** Resolve after all Promises resolve to a falsy value. Otherwise, never settle. */
const noPromises = async (promises: Promise<any>[]): Promise<void> =>
  Promise.all(
    promises.map((p) =>
      p.then(
        (value) => !!value && new Promise<never>(() => {})
      )
    )
  ).then(() => {})
