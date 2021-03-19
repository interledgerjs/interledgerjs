import { AssetDetails, isValidAssetDetails } from './controllers/asset-details'
import { AssetProbe } from './controllers/asset-probe'
import { ConnectionCloser } from './controllers/connection-closer'
import { PaymentController, PaymentType } from './controllers/payment'
import { RateProbe } from './controllers/rate-probe'
import { fetchPaymentDetails, PaymentDestination } from './open-payments'
import { Int, isNonNegativeRational, NonNegativeRational, PositiveInt, Ratio } from './utils'
import { StreamConnection } from './connection'
import { Plugin } from './request'

export { Int, Ratio, PositiveInt, PositiveRatio } from './utils'
export { AssetDetails } from './controllers/asset-details'
export { Invoice } from './open-payments'
export { AccountUrl } from './payment-pointer'

/** Recipient-provided details to resolve payment parameters, and connected ILP uplink */
export interface SetupOptions {
  /** Plugin to send ILP packets over the network */
  plugin: Plugin
  /** Payment pointer, Open Payments or SPSP account URL to query STREAM connection credentials */
  paymentPointer?: string
  /** Open Payments invoice URL to resolve details and credentials to pay a fixed-delivery payment */
  invoiceUrl?: string
  /** For testing purposes: symmetric key to encrypt STREAM messages. Requires `destinationAddress` */
  sharedSecret?: Uint8Array
  /** For testing purposes: ILP address of the STREAM receiver to send outgoing packets. Requires `sharedSecret` */
  destinationAddress?: string
  /** For testing purposes: asset details of the STREAM recipient, overriding STREAM and invoice. Requires `destinationAddress` */
  destinationAsset?: AssetDetails
}

/** Resolved destination details of a proposed payment, such as the destination asset, invoice, and STREAM credentials, ready to perform a quote */
export interface ResolvedPayment extends PaymentDestination {
  /** Perform a rate probe: discover path max packet amount, probe the real exchange rate, and compute the minimum exchange rate and bounds of the payment. */
  startQuote: (options: QuoteOptions) => Promise<Quote>
  /** Cancel the payment: if connection was established, notify receiver to close the connection */
  close: () => Promise<void>
  /** Asset and denomination of the receiver's Interledger account */
  destinationAsset: AssetDetails
}

/** Limits and target to quote a payment and probe the rate */
export interface QuoteOptions {
  /** Asset and denomination of the sending account */
  sourceAsset?: AssetDetails
  /** Fixed amount to send to the recipient, in base units of source asset */
  amountToSend?: Int | string | number | bigint
  /** Fixed amount to deliver to the recipient, in base units of destination asset */
  amountToDeliver?: Int | string | number | bigint
  /** Percentage to subtract from an external exchange rate to determine the minimum acceptable exchange rate */
  slippage?: number
  /** Set of asset codes -> price in a standardized base asset, to compute minimum exchange rates */
  prices?: {
    [assetCode: string]: number
  }
}

/** Parameters of payment execution and the projected outcome of a payment */
export interface Quote {
  /** Execute the payment within these parameters */
  pay: (options?: PayOptions) => Promise<Receipt>
  /** Cancel the payment: notify receiver to close the connection */
  close: () => Promise<void>
  /** Maximum amount that will be sent in source units */
  maxSourceAmount: PositiveInt
  /** Minimum amount that will be delivered if the payment completes */
  minDeliveryAmount: Int
  /** Discovered maximum packet amount allowed over this payment path */
  maxPacketAmount: Int
  /** Probed exchange rate over the path: range of [minimum, maximum]. Ratios of destination base units to source base units */
  estimatedExchangeRate: [Ratio, Ratio]
  /** Minimum exchange rate used to enforce rates. Ratio of destination base units to source base units */
  minExchangeRate: Ratio
  /** Estimated payment duration in milliseconds, based on max packet amount, RTT, and rate of packet throttling */
  estimatedDuration: number
}

/** Options before immediately executing payment */
export interface PayOptions {
  /**
   * Callback to process streaming updates as packets are sent and received,
   * such as to perform accounting while the payment is in progress.
   *
   * Handler will be called for all fulfillable packets and replies before the payment resolves.
   */
  progressHandler?: (receipt: Receipt) => void
}

/** Intermediate state or outcome of the payment, to account for sent/delivered amounts */
export interface Receipt {
  /** Error state, if the payment failed */
  error?: PaymentError
  /** Amount sent and fulfilled, in base units of the source asset */
  amountSent: Int
  /** Amount delivered to recipient, in base units of the destination asset */
  amountDelivered: Int
  /** Amount sent that is yet to be fulfilled or rejected, in base units of the source asset */
  sourceAmountInFlight: Int
  /** Estimate of the amount that may be delivered from in-flight packets, in base units of the destination asset */
  destinationAmountInFlight: Int
  /** Latest [STREAM receipt](https://interledger.org/rfcs/0039-stream-receipts/) to provide proof-of-delivery to a 3rd party verifier */
  streamReceipt?: Uint8Array
}

/** Payment error states */
export enum PaymentError {
  /**
   * Errors likely caused by the library user
   */

  /** Payment pointer or SPSP URL is syntactically invalid */
  InvalidPaymentPointer = 'InvalidPaymentPointer',
  /** STREAM credentials (shared secret and destination address) were not provided or invalid */
  InvalidCredentials = 'InvalidCredentials',
  /** Slippage percentage is not between 0 and 1 (inclusive) */
  InvalidSlippage = 'InvalidSlippage',
  /** Source asset or denomination was not provided */
  UnknownSourceAsset = 'UnknownSourceAsset',
  /** No fixed source amount or fixed destination amount was provided */
  UnknownPaymentTarget = 'UnknownPaymentTarget',
  /** Fixed source amount is invalid or too precise for the source account */
  InvalidSourceAmount = 'InvalidSourceAmount',
  /** Fixed delivery amount is invalid or too precise for the destination account */
  InvalidDestinationAmount = 'InvalidDestinationAmount',
  /** Minimum exchange rate is 0 after subtracting slippage and cannot enforce a fixed-delivery payment */
  UnenforceableDelivery = 'UnenforceableDelivery',

  /**
   * Errors likely caused by the receiver, connectors, or other externalities
   */

  /** Failed to query an account or invoice from an Open Payments or SPSP server */
  QueryFailed = 'QueryFailed',
  /** Invoice was already fully paid or overpaid, so no payment is necessary */
  InvoiceAlreadyPaid = 'InvoiceAlreadyPaid',
  /** Cannot send over this path due to an ILP Reject error */
  ConnectorError = 'ConnectorError',
  /** No authentic reply from receiver: packets may not have been delivered */
  EstablishmentFailed = 'EstablishmentFailed',
  /** Destination asset details are unknown or the receiver never provided them */
  UnknownDestinationAsset = 'UnknownDestinationAsset',
  /** Receiver sent conflicting destination asset details */
  DestinationAssetConflict = 'DestinationAssetConflict',
  /** Failed to compute minimum rate: prices for source or destination assets were invalid or not provided */
  ExternalRateUnavailable = 'ExternalRateUnavailable',
  /** Rate probe failed to establish the exchange rate or discover path max packet amount */
  RateProbeFailed = 'RateProbeFailed',
  /** Real exchange rate is less than minimum exchange rate with slippage */
  InsufficientExchangeRate = 'InsufficientExchangeRate',
  /** No packets were fulfilled within timeout */
  IdleTimeout = 'IdleTimeout',
  /** Receiver closed the connection or stream, terminating the payment */
  ClosedByReceiver = 'ClosedByReceiver',
  /** Estimated destination amount exceeds the receiver's limit */
  IncompatibleReceiveMax = 'IncompatibleReceiveMax',
  /** Receiver violated the STREAM protocol, misrepresenting delivered amounts */
  ReceiverProtocolViolation = 'ReceiverProtocolViolation',
  /** Encrypted maximum number of packets using the key for this connection */
  ExceededMaxSequence = 'ExceededMaxSequence',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isPaymentError = (o: any): o is PaymentError => Object.values(PaymentError).includes(o)

/** Resolve destination details and asset of the payment in order to establish a STREAM connection */
export const setupPayment = async (options: SetupOptions): Promise<ResolvedPayment> => {
  // Determine STREAM credentials, amount to pay, and destination details
  // by performing Open Payments/SPSP queries, or using the provided info
  const destinationDetailsOrError = await fetchPaymentDetails(options)
  if (isPaymentError(destinationDetailsOrError)) {
    throw destinationDetailsOrError
  }
  const destinationDetails = destinationDetailsOrError
  const { invoice } = destinationDetails

  // Generate encryption keys and prepare to orchestrate send loops
  const connection = await StreamConnection.create(options.plugin, destinationDetails)
  const { log } = connection

  // Callback to send connection close frame
  const close = async (): Promise<void> => {
    await connection.runSendLoop(new ConnectionCloser())
  }

  // Use STREAM to fetch the destination asset (returns immediately if asset is already known)
  const assetOrError = await connection.runSendLoop(new AssetProbe())
  if (isPaymentError(assetOrError)) {
    await close()
    throw assetOrError
  }
  const destinationAsset = assetOrError

  const startQuote = async (options: QuoteOptions): Promise<Quote> => {
    // Validate the amounts to set the target for the payment
    let target: {
      type: PaymentType
      amount: PositiveInt
    }

    if (invoice) {
      const remainingToDeliver = invoice.amountToDeliver.saturatingSubtract(invoice.amountDelivered)
      if (!remainingToDeliver.isPositive()) {
        // Return thie error here instead of in `setupPayment` so consumer can access the resolved invoice
        log.debug(
          'quote failed: invoice was already paid. amountToDeliver=%s amountDelivered=%s',
          invoice.amountToDeliver,
          invoice.amountDelivered
        )
        // In invoice case, STREAM connection is yet to be established since no asset probe
        throw PaymentError.InvoiceAlreadyPaid
      }

      target = {
        type: PaymentType.FixedDelivery,
        amount: remainingToDeliver,
      }
    }
    // Validate the target amount is non-zero and compatible with the precision of the accounts
    else if (options.amountToSend !== undefined) {
      const amountToSend = Int.from(options.amountToSend)
      if (!amountToSend || !amountToSend.isPositive()) {
        log.debug('invalid config: amount to send is not a positive integer')
        await close()
        throw PaymentError.InvalidSourceAmount
      }

      target = {
        type: PaymentType.FixedSend,
        amount: amountToSend,
      }
    } else if (options.amountToDeliver !== undefined) {
      const amountToDeliver = Int.from(options.amountToDeliver)
      if (!amountToDeliver || !amountToDeliver.isPositive()) {
        log.debug('invalid config: amount to deliver is not a positive integer')
        await close()
        throw PaymentError.InvalidDestinationAmount
      }

      target = {
        type: PaymentType.FixedDelivery,
        amount: amountToDeliver,
      }
    } else {
      log.debug('invalid config: no invoice, amount to send, or amount to deliver was provided')
      await close()
      throw PaymentError.UnknownPaymentTarget
    }

    // Validate the slippage
    const slippage = options.slippage ?? 0.01
    if (!isNonNegativeRational(slippage) || slippage > 1) {
      log.debug('invalid config: slippage is not a number between 0 and 1')
      await close()
      throw PaymentError.InvalidSlippage
    }

    // Validate source asset details
    const { sourceAsset } = options
    if (!isValidAssetDetails(sourceAsset)) {
      log.debug('invalid config: no source asset details were provided')
      await close()
      throw PaymentError.UnknownSourceAsset
    }

    // Determine minimum exchange rate
    let externalRate = 1 // Default to 1:1 rate for the same asset
    if (sourceAsset.code !== destinationAsset.code) {
      const sourcePrice = options.prices?.[sourceAsset.code]
      const destinationPrice = options.prices?.[destinationAsset.code]

      // Ensure the prices are defined, finite, and denominator > 0
      if (
        !isNonNegativeRational(sourcePrice) ||
        !isNonNegativeRational(destinationPrice) ||
        destinationPrice === 0
      ) {
        log.debug(
          'quote failed: no external rate available from %s to %s',
          sourceAsset.code,
          destinationAsset.code
        )
        await close()
        throw PaymentError.ExternalRateUnavailable
      }

      // This seems counterintuitive because rates are destination amount / source amount,
      // but each price *is a rate*, not an amount.
      // For example: sourcePrice => USD/ABC, destPrice => USD/XYZ, externalRate => XYZ/ABC
      externalRate = sourcePrice / destinationPrice
    }

    // prettier-ignore
    externalRate =
      externalRate *
      (1 - slippage) *
      10 ** (destinationAsset.scale - sourceAsset.scale)

    const minExchangeRate = Ratio.from(externalRate as NonNegativeRational)
    log.debug('calculated min exchange rate of %s', minExchangeRate)

    log.debug('starting quote.')
    // Perform rate probe: probe realized rate and discover path max packet amount
    const rateProbeResult = await connection.runSendLoop(new RateProbe())
    if (isPaymentError(rateProbeResult)) {
      await close()
      throw rateProbeResult
    }
    log.debug('quote complete.')

    // Set the amounts to pay/deliver and perform checks to determine
    // if this is possible given the probed & minimum rates
    const { rateCalculator, maxPacketAmount, packetFrequency } = rateProbeResult
    const paymentTarget = PaymentController.createPaymentTarget(
      target.amount,
      target.type,
      minExchangeRate,
      rateCalculator,
      log
    )
    if (isPaymentError(paymentTarget)) {
      await close()
      throw paymentTarget
    }

    // Get strict amounts for accounting
    const { maxSourceAmount, minDeliveryAmount } = paymentTarget

    // Estimate how long the payment may take based on max packet amount, RTT, and rate of packet sending
    const estimatedNumberOfPackets = maxSourceAmount.divideCeil(maxPacketAmount)
    const estimatedDuration = +estimatedNumberOfPackets * packetFrequency

    return {
      estimatedExchangeRate: rateCalculator.getRate(),
      minExchangeRate,
      maxPacketAmount,
      maxSourceAmount,
      minDeliveryAmount,
      estimatedDuration,
      close,
      pay: async ({ progressHandler } = {}) => {
        log.debug('starting payment.')
        const paymentSender = new PaymentController(paymentTarget, progressHandler)
        const error = await connection.runSendLoop(paymentSender)

        await close()

        return {
          ...(isPaymentError(error) && { error }),
          ...paymentSender.getReceipt(),
        }
      },
    }
  }

  return {
    startQuote,
    close,
    ...destinationDetails,
    destinationAsset,
  }
}
