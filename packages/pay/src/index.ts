import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { createConnection } from './connection'
import {
  AssetDetails,
  isValidAssetDetails,
  AssetDetailsController,
} from './controllers/asset-details'
import { AssetProbe } from './controllers/asset-probe'
import { ConnectionCloser } from './controllers/connection-closer'
import { PacingController } from './controllers/pacer'
import { PaymentController, PaymentType } from './controllers/payment'
import { RateProbe } from './controllers/rate-probe'
import { fetchPaymentDetails, PaymentDestination } from './open-payments'
import { Int, isNonNegativeRational, NonNegativeRational, PositiveInt, Ratio } from './utils'
import { ControllerSet } from './controllers'
import { EstablishmentController } from './controllers/establishment'

export { Int, Ratio, PositiveInt, PositiveRatio } from './utils'

export { AssetDetails } from './controllers/asset-details'

export { Invoice } from './open-payments'

/** TODO explain */
export interface SetupOptions {
  /** Plugin to send ILP packets over the network */
  plugin: Plugin // TODO You could *almost* replace with a `sendData` function... no connect/disconnect necessary...
  /** Payment pointer, Open Payments or SPSP account URL to query STREAM connection credentials */
  paymentPointer?: string
  /** Open Payments invoice URL to resolve details and credentials to pay a fixed-delivery payment */
  invoiceUrl?: string
  /** For testing purposes: symmetric key to encrypt STREAM messages. Requires `destinationAddress` */
  sharedSecret?: Buffer
  /** For testing purposes: ILP address of the STREAM receiver to send outgoing packets. Requires `sharedSecret` */
  destinationAddress?: string
  /** For testing purposes: asset details of the STREAM recipient, overriding STREAM and invoice. Requires `destinationAddress` */
  destinationAsset?: AssetDetails
}

/** Limits and target to quote a payment and probe the rate */
export interface QuoteOptions {
  /** Asset and denomination of the sending account */
  sourceAsset: AssetDetails // TODO Should this be optional in case slippage = 100% ?
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

/** TODO explain */
export interface ResolvedPayment extends PaymentDestination {
  /** TODO explain */
  quote: (options: QuoteOptions) => Promise<Quote>
  /** TODO explain */
  close: () => Promise<void>
}

/** TODO explain */
export interface PayOptions {
  /**
   * Callback to process streaming updates as packets are sent and received,
   * such as to perform accounting while the payment is in progress.
   */
  progressHandler?: (receipt: Receipt) => void
}

/** Parameters of payment execution and the projected outcome of a payment */
export interface Quote {
  /** Execute the payment within these parameters */
  pay: (options?: PayOptions) => Promise<Receipt>
  /** Cancel the payment (disconnects the plugin and closes connection with recipient) */
  close: () => Promise<void>
  /** Maximum amount that will be sent in source units */
  maxSourceAmount: PositiveInt
  /** Minimum amount that will be delivered if the payment completes */
  minDeliveryAmount: Int
  /** Discovered maximum packet amount allowed over this payment path */
  maxPacketAmount: Int
  /** Probed exchange rate over the path: range of [minimum, maximum] */
  estimatedExchangeRate: [number, number]
  /** Minimum exchange rate used to enforce rates */
  minExchangeRate: number
  /** Estimated payment duration in milliseconds, based on max packet amount, RTT, and rate of packet throttling */
  estimatedDuration: number
}

/** Final outcome of a payment */
export interface Receipt {
  error?: PaymentError // TODO Remove this!
  /** Amount sent and fulfilled, in base units of the source asset */
  amountSent: Int
  /** Amount delivered to recipient, in base units of the destination asset */
  amountDelivered: Int
  /** Amount sent that is yet to be fulfilled or rejected, in scaled units of the sending account */
  sourceAmountInFlight: Int
  /** Estimate of the amount that may be delivered from in-flight packets, in scaled units of the receiving account */
  destinationAmountInFlight: Int
  /** Latest [STREAM receipt](https://interledger.org/rfcs/0039-stream-receipts/) to provide proof-of-delivery to a 3rd party verifier */
  streamReceipt?: Buffer
}

/** Payment error states */
export enum PaymentError {
  /**
   * Errors likely caused by the library user
   */

  /** Payment pointer or SPSP URL is formatted incorrectly */
  InvalidPaymentPointer = 'InvalidPaymentPointer',
  /** STREAM credentials (shared secret and destination address) were not provided or invalid */
  InvalidCredentials = 'InvalidCredentials',
  /** Plugin failed to connect or is disconnected from the Interleder network */
  Disconnected = 'Disconnected',
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
  /** No authentic reply from receiver, packets may not have been delivered */
  EstablishmentFailed = 'EstablishmentFailed',
  /** Destination asset details are unknown or the receiver never provided them */
  UnknownDestinationAsset = 'UnknownDestinationAsset',
  /** Receiver sent conflicting destination asset details */
  DestinationAssetConflict = 'DestinationAssetConflict',
  /** Failed to compute a minimum exchange rate */
  ExternalRateUnavailable = 'ExternalRateUnavailable',
  /** Rate probe failed to establish the exchange rate or discover path max packet amount */
  RateProbeFailed = 'RateProbeFailed',
  /** Real exchange rate is less than minimum exchange rate with slippage */
  InsufficientExchangeRate = 'InsufficientExchangeRate',
  /** Exchange rate is too close to minimum rate to deliver max packet amount without rounding errors */
  ExchangeRateRoundingError = 'ExchangeRateRoundingError',
  /** No packets were fulfilled within timeout */
  IdleTimeout = 'IdleTimeout',
  /** The recipient closed the connection or stream, terminating the payment */
  ClosedByRecipient = 'ClosedByRecipient',
  /** Receiver's advertised limit is incompatible with the amount we may deliver */
  IncompatibleReceiveMax = 'IncompatibleReceiveMax',
  /** Receiver violated the STREAM protocol, misrepresenting delivered amounts */
  ReceiverProtocolViolation = 'ReceiverProtocolViolation',
  /** Encrypted maximum number of packets using the key for this connection */
  ExceededMaxSequence = 'ExceededMaxSequence',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isPaymentError = (o: any): o is PaymentError => Object.values(PaymentError).includes(o)

/** TODO add explanation */
export const setupPayment = async (options: SetupOptions): Promise<ResolvedPayment> => {
  const { plugin } = options

  // Determine STREAM credentials, amount to pay, and destination details
  // by performing Open Payments/SPSP queries, or using the provided info
  const destinationDetailsOrError = await fetchPaymentDetails(options)
  if (isPaymentError(destinationDetailsOrError)) {
    throw destinationDetailsOrError
  }
  const destinationDetails = destinationDetailsOrError
  const { destinationAddress, sharedSecret, invoice } = destinationDetails

  // Connect plugin, generate encryption keys, create connection logger
  const connectionOrError = await createConnection(plugin, destinationDetails)
  if (isPaymentError(connectionOrError)) {
    throw connectionOrError
  }
  const connection = connectionOrError
  const { log } = connection

  // TODO Note: these are both destination details... what if they were accessible/exposed via the StreamConnection?
  const controllers = new ControllerSet()
    .add(new EstablishmentController(destinationAddress))
    .add(new AssetDetailsController(destinationDetails.destinationAsset))

  // Callback to send connection close frame and disconnect the plugin
  const close = async () => {
    log.debug('trying to send connection close frame.')
    await new ConnectionCloser(connection, controllers).run()
    await connection.close()
  }

  // Use STREAM to fetch the destination asset if it's not already known
  const destinationAsset =
    destinationDetails.destinationAsset ??
    (await (async () => {
      log.debug('starting asset probe.')
      const assetProbeResult = await new AssetProbe(connection, controllers).run()
      if (isPaymentError(assetProbeResult)) {
        await close()
        throw assetProbeResult
      }

      log.debug('asset probe complete.')
      return assetProbeResult
    })())

  const quote = async (options: QuoteOptions): Promise<Quote> => {
    // Validate the amounts to set the target for the payment
    let target: {
      type: PaymentType
      amount: PositiveInt
    }
    if (invoice) {
      const remainingToDeliver = invoice.amountToDeliver.subtract(invoice.amountDelivered)
      if (!remainingToDeliver.isPositive()) {
        log.debug(
          'quote failed: invoice was already paid. amountToDeliver=%s amountDelivered=%s',
          invoice.amountToDeliver,
          invoice.amountDelivered
        )
        await close()
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
    if (sourceAsset.assetCode !== destinationAsset.assetCode) {
      const sourcePrice = options.prices?.[sourceAsset.assetCode]
      const destinationPrice = options.prices?.[destinationAsset.assetCode]

      // Ensure the prices are defined, finite, and denominator > 0
      if (
        !isNonNegativeRational(sourcePrice) ||
        !isNonNegativeRational(destinationPrice) ||
        destinationPrice === 0
      ) {
        log.debug(
          'quote failed: no external rate available from %s to %s',
          sourceAsset.assetCode,
          destinationAsset.assetCode
        )
        await close()
        throw PaymentError.ExternalRateUnavailable
      }

      // This seems counterintuitive because the rate is typically destination amount / source amount,
      // but each price *is a rate*, not an amount.
      // For example: sourcePrice => USD / ABC, destPrice => USD / XYZ, externalRate => XYZ / ABC,
      externalRate = sourcePrice / destinationPrice
    }

    // prettier-ignore
    externalRate =
      externalRate *
      (1 - slippage) *
      10 ** (destinationAsset.assetScale - sourceAsset.assetScale)

    const minimumRate = Ratio.from(externalRate as NonNegativeRational)
    log.debug('calculated min exchange rate of %s', minimumRate)

    log.debug('starting quote.')

    // Perform rate probe: probe realized rate and discover path max packet amount
    const rateProbeResult = await new RateProbe(connection, controllers).run()
    if (isPaymentError(rateProbeResult)) {
      await close()
      throw rateProbeResult
    }

    // Set the amounts to pay/deliver and perform checks to determine
    // if this is possible given the probed & minimum rates
    const { rateCalculator, maxPacketAmount } = rateProbeResult
    const paymentTarget = PaymentController.createPaymentTarget(
      target.amount,
      target.type,
      minimumRate,
      rateCalculator,
      maxPacketAmount,
      log
    )
    if (isPaymentError(paymentTarget)) {
      await close()
      throw paymentTarget
    }

    log.debug('quote complete.')

    // Convert exchange rates into normalized units
    const shiftRate = (rate: Ratio): number =>
      +rate * 10 ** (sourceAsset.assetScale - destinationAsset.assetScale)
    const lowerBoundRate = shiftRate(rateCalculator.lowerBoundRate)
    const upperBoundRate = shiftRate(rateCalculator.upperBoundRate)
    const minExchangeRate = shiftRate(minimumRate)

    // Get strict amounts for accounting
    const { maxSourceAmount, minDeliveryAmount } = paymentTarget

    // Estimate how long the payment may take based on max packet amount, RTT, and rate of packet sending
    const packetFrequency = controllers.get(PacingController).getPacketFrequency()
    const estimatedNumberOfPackets = maxSourceAmount.divideCeil(maxPacketAmount)
    const estimatedDuration = +estimatedNumberOfPackets * packetFrequency

    return {
      estimatedExchangeRate: [lowerBoundRate, upperBoundRate],
      minExchangeRate,
      maxPacketAmount,
      maxSourceAmount,
      minDeliveryAmount,
      estimatedDuration,
      close,
      pay: async ({ progressHandler } = {}) => {
        log.debug('starting payment.')

        // TODO Is this good? Don't I still want a receipt/payment progress if the payment
        //      times out and only partially completed?

        const receiptOrError = await new PaymentController(
          connection,
          controllers,
          paymentTarget,
          progressHandler
        ).run()

        await close()
        log.debug('payment ended.')

        if (isPaymentError(receiptOrError)) {
          throw receiptOrError
        } else {
          return receiptOrError
        }
      },
    }
  }

  return {
    quote,
    close,
    sharedSecret,
    destinationAddress,
    destinationAsset,
    invoice,
  }
}
