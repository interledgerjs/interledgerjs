import BigNumber from 'bignumber.js'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { ControllerMap } from './controllers'
import { AccountController, AccountDetails } from './controllers/asset-details'
import { PendingRequestTracker } from './controllers/pending-requests'
import { fetchCoinCapRates } from './rates/coincap'
import { isValidIlpAddress, isValidAssetScale, getScheme } from './utils'
import { AmountController, PaymentType } from './controllers/amount'
import { ExchangeRateController } from './controllers/exchange-rate'
import { SequenceController } from './controllers/sequence'
import { PacingController } from './controllers/pacer'
import { FailureController } from './controllers/failure'
import { MaxPacketAmountController } from './controllers/max-packet'
import { createConnection } from './connection'
import { RateProbe } from './controllers/rate-probe'
import { fetch as sendIldcpRequest } from 'ilp-protocol-ildcp'
import {
  getConnectionId,
  Ratio,
  isNonNegativeNumber,
  NonNegativeNumber,
  PositiveInt,
  Int,
} from './utils'
import createLogger from 'ilp-logger'
import { fetchPaymentDetails } from './open-payments'

export { AccountDetails } from './controllers/asset-details'

/** Parameters to setup and prepare a payment */
export interface PaymentOptions {
  /** Plugin to send (and optionally, receive) ILP packets over the network */
  plugin: Plugin
  /** Payment pointer, Open Payments or SPSP account URL to query STREAM connection credentials */
  paymentPointer?: string
  /** Open Payments invoice URL to resolve details and credentials to pay a fixed-delivery payment */
  invoiceUrl?: string
  /** Fixed amount to send to the recipient, in normalized source units with arbitrary precision */
  amountToSend?: BigNumber.Value
  /** Percentage to subtract from an external exchange rate to determine the minimum acceptable exchange rate */
  slippage?: number
  /**
   * Set of asset codes -> price in a standardized base asset, to calculate exchange rates.
   * By default, rates will be pulled from the CoinCap API
   */
  prices?: {
    [assetCode: string]: number
  }
  /** Callback to set the expiration timestamp of each packet given the destination ILP address */
  getExpiry?: (destination?: string) => Date
  /** For testing purposes: fixed amount to deliver to the recipient, in base units */
  amountToDeliver?: Int
  /** For testing purposes: ILP address of the STREAM receiver to send outgoing packets. Requires `sharedSecret` */
  destinationAddress?: string
  /** For testing purposes: symmetric key to encrypt STREAM messages. Requires `destinationAddress` */
  sharedSecret?: Buffer
}

/** [Open Payments invoice](https://docs.openpayments.dev/invoices) metadata */
export interface Invoice {
  /** URL identifying the invoice */
  invoiceUrl: string
  /** URL identifying the account into which payments toward the invoice will be credited */
  accountUrl: string
  /** UNIX timestamp in milliseconds when payments toward the invoice will no longer be accepted */
  expiresAt: NonNegativeNumber
  /** Human-readable description of the invoice */
  description: string
  /** Fixed destination amount that must be delivered to complete payment of the invoice, in ordinary units */
  amountToDeliver: BigNumber
  /** Amount that has already been paid toward the invoice, in ordinary units */
  amountDelivered: BigNumber
  /** Precision of the recipient's asset denomination: number of decimal places of the ordinary unit */
  assetCode: string
  /** Asset code or symbol identifying the currency of the destination account */
  assetScale: number
}

/** Parameters of payment execution and the projected outcome of a payment */
export interface Quote {
  /** Execute the payment within these parameters */
  pay: () => Promise<Receipt>
  /** Cancel the payment (disconnects the plugin and closes connection with recipient) */
  cancel: () => Promise<void>
  /** Maximum amount that will be sent in source units */
  maxSourceAmount: BigNumber
  /** Minimum amount that will be delivered if the payment completes */
  minDeliveryAmount: BigNumber
  /** Probed exchange rate over the path: range of [minimum, maximum] */
  estimatedExchangeRate: [BigNumber, BigNumber]
  /** Minimum exchange rate used to enforce rates */
  minExchangeRate: BigNumber
  /** Estimated payment duration in milliseconds, based on max packet amount, RTT, and rate of packet throttling */
  estimatedDuration: number
  /** Source account details */
  sourceAccount: AccountDetails
  /** Destination account details */
  destinationAccount: AccountDetails
  /** Open Payments invoice metadata, if the payment pays into an invoice */
  invoice?: Invoice
}

/** Final outcome of a payment */
export interface Receipt {
  /** Error type if the payment failed with an error */
  error?: PaymentError
  /** Amount sent and fulfilled, in normalized source units with arbitrary precision */
  amountSent: BigNumber
  /** Amount delivered to recipient, in normalized destination units with arbitrary precision */
  amountDelivered: BigNumber
  /** Source account details */
  sourceAccount: AccountDetails
  /** Destination account details */
  destinationAccount: AccountDetails
}

/** Payment error states */
export enum PaymentError {
  /**
   * Errors likely caused by the library user
   */

  /** Payment pointer is formatted incorrectly */
  InvalidPaymentPointer = 'InvalidPaymentPointer',
  /** STREAM credentials (shared secret and destination address) were not provided or invalid */
  InvalidCredentials = 'InvalidCredentials',
  /** Plugin failed to connect or is disconnected from the Interleder network */
  Disconnected = 'Disconnected',
  /** Slippage percentage is not between 0 and 1 (inclusive) */
  InvalidSlippage = 'InvalidSlippage',
  /** Sender and receiver use incompatible Interledger network prefixes */
  IncompatibleInterledgerNetworks = 'IncompatibleInterledgerNetworks',
  /** Failed to fetch IL-DCP details for the source account: unknown sending asset or ILP address */
  UnknownSourceAsset = 'UnknownSourceAsset',
  /** No fixed source amount or fixed destination amount was provided */
  UnknownPaymentTarget = 'UnknownPaymentTarget',
  /** Fixed source amount is invalid or too precise for the source account */
  InvalidSourceAmount = 'InvalidSourceAmount',
  /** Fixed delivery amount is invalid or too precise for the destination account */
  InvalidDestinationAmount = 'InvalidDestinationAmount',
  /** Minimum exchange rate is 0 after subtracting slippage, and cannot enforce a fixed-delivery payment */
  UnenforceableDelivery = 'UnenforceableDelivery',

  /**
   * Errors likely caused by the receiver, connectors, or other externalities
   */

  /** Failed to query an account or invoice from an Open Payments or SPSP server */
  QueryFailed = 'QueryFailed',
  /** Invoice is complete: amount paid into the invoice already meets or exceeds the invoice amount */
  InvoiceAlreadyPaid = 'InvoiceAlreadyPaid',
  /** Failed to fetch the external exchange rate and unable to enforce a minimum exchange rate */
  ExternalRateUnavailable = 'ExternalRateUnavailable',
  /** Probed exchange rate is too low: less than the minimum pulled from external rate APIs */
  InsufficientExchangeRate = 'InsufficientExchangeRate',
  /** Destination asset details are unknown or the receiver never provided them */
  UnknownDestinationAsset = 'UnknownDestinationAsset',
  /** Receiver sent conflicting destination asset details */
  DestinationAssetConflict = 'DestinationAssetConflict',
  /** Receiver's advertised limit is incompatible with the amount we want to send or deliver to them */
  IncompatibleReceiveMax = 'IncompatibleReceiveMax',
  /** The recipient closed the connection or stream, terminating the payment */
  ClosedByRecipient = 'ClosedByRecipient',
  /** Receiver violated the STREAM protocol that prevented accounting for delivered amounts */
  ReceiverProtocolViolation = 'ReceiverProtocolViolation',
  /** Rate probe failed to establish the realized exchange rate */
  RateProbeFailed = 'RateProbeFailed',
  /** Failed to fulfill a packet before payment timed out */
  IdleTimeout = 'IdleTimeout',
  /** Encountered an ILP Reject that cannot be retried, or the payment is not possible over this path */
  ConnectorError = 'ConnectorError',
  /** Sent too many packets with this encryption key and must close the connection */
  ExceededMaxSequence = 'ExceededMaxSequence',
  /** Rate enforcement is not possible due to rounding: max packet amount may be too low, minimum exchange rate may require more slippage, or exchange rate may be insufficient */
  ExchangeRateRoundingError = 'ExchangeRateRoundingError',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isPaymentError = (o: any): o is PaymentError => Object.values(PaymentError).includes(o)

/**
 * Quote and prepare to perform a payment:
 * - Query the recipient's payment pointer, if provided
 * - Ensure viable payment path to recipient
 * - Probe the realized rate to the recipient
 * - Prepare to enforce exchange rate by comparing against
 *   rates pulled from external sources
 */
export const quote = async ({ plugin, ...options }: PaymentOptions): Promise<Quote> => {
  let log = createLogger('ilp-pay')

  // Validate the slippage
  const slippage = options.slippage ?? 0.01
  if (!isNonNegativeNumber(slippage) || slippage > 1) {
    log.debug('invalid config: slippage is not a number between 0 and 1')
    throw PaymentError.InvalidSlippage
  }

  // Determine STREAM credentials, amount to pay, and destination details
  // by performing Open Payments/SPSP queries, or using the provided info
  const recipientDetailsOrError = await fetchPaymentDetails(options)
  if (isPaymentError(recipientDetailsOrError)) {
    throw recipientDetailsOrError
  }
  const { sharedSecret, destinationAddress, destinationAsset, invoice } = recipientDetailsOrError

  const connectionId = await getConnectionId(destinationAddress)
  log = log.extend(connectionId)

  // TODO Add timeout here?
  await plugin.connect().catch((err: Error) => {
    log.debug('error connecting plugin:', err)
    throw PaymentError.Disconnected
  })

  const close = async () => {
    // TODO Add timeout here?
    await plugin
      .disconnect()
      .then(() => log.debug('plugin disconnected.'))
      .catch((err: Error) => log.error('error disconnecting plugin:', err))
    plugin.deregisterDataHandler()
  }

  // Fetch asset details of source account
  // TODO Add timeout here?
  const sourceAccount: AccountDetails = await sendIldcpRequest((data) => plugin.sendData(data))
    .catch(async (err) => {
      log.debug('quote failed: IL-DCP request to fetch source asset failed:', err)
      await close()
      throw PaymentError.UnknownSourceAsset
    })
    .then(async ({ assetCode, assetScale, clientAddress }) => {
      if (!isValidAssetScale(assetScale) || !isValidIlpAddress(clientAddress)) {
        log.debug('quote failed: source asset details from IL-DCP request are invalid')
        await close()
        throw PaymentError.UnknownSourceAsset
      }

      return {
        assetCode,
        assetScale,
        ilpAddress: clientAddress,
      }
    })

  // Sanity check to ensure sender and receiver use the same network/prefix
  if (getScheme(sourceAccount.ilpAddress) !== getScheme(destinationAddress)) {
    log.debug(
      'quote failed: incompatible address schemes. source address: %s, destination address: %s',
      sourceAccount.ilpAddress,
      destinationAddress
    )
    await close()
    throw PaymentError.IncompatibleInterledgerNetworks
  }

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
    const amountToSend = Int.from(
      new BigNumber(options.amountToSend).shiftedBy(sourceAccount.assetScale)
    )
    if (!amountToSend || !amountToSend.isPositive()) {
      log.debug(
        'invalid config: amount to send is not a positive integer or more precise than the source account'
      )
      await close()
      throw PaymentError.InvalidSourceAmount
    }

    target = {
      type: PaymentType.FixedSend,
      amount: amountToSend,
    }
  } else if (options.amountToDeliver !== undefined) {
    log.warn('amountToDeliver is for testing. invoices are recommended for fixed-delivery')

    if (!options.amountToDeliver.isPositive()) {
      log.debug(
        'invalid config: amount to deliver is not a positive integer or more precise than the destination account'
      )
      await close()
      throw PaymentError.InvalidDestinationAmount
    }

    target = {
      type: PaymentType.FixedDelivery,
      amount: options.amountToDeliver,
    }
  } else {
    log.debug('invalid config: no invoice, amount to send, or amount to deliver was provided')
    await close()
    throw PaymentError.UnknownPaymentTarget
  }

  const controllers: ControllerMap = new Map()
  controllers
    // First so all other controllers log the sequence number
    .set(SequenceController, new SequenceController())
    // Fail-fast on terminal rejects or timeouts
    .set(FailureController, new FailureController())
    // Fail-fast on destination asset detail conflict
    .set(
      AccountController,
      new AccountController(sourceAccount, destinationAddress, destinationAsset)
    )
    // Fail-fast if max packet amount is 0
    .set(MaxPacketAmountController, new MaxPacketAmountController())
    // Limit how frequently packets are sent and early return
    .set(PacingController, new PacingController())
    .set(AmountController, new AmountController(controllers))
    .set(ExchangeRateController, new ExchangeRateController())
    .set(RateProbe, new RateProbe(controllers))
    // Ensure each controller processes reply before resolving Promises
    .set(PendingRequestTracker, new PendingRequestTracker())

  // Register handlers for incoming packets and generate encryption keys
  const connection = await createConnection(
    plugin,
    controllers,
    sharedSecret,
    destinationAddress,
    options.getExpiry
  )

  log.debug('starting quote.')

  // Send test packets
  // - Fetch asset details from the recipient
  // - Ensure the recipient is routable
  // - Probe the realized exchange rate
  // - Discover path max packet amount
  const probeResult = await Promise.race([
    connection.runSendLoop(),
    controllers.get(RateProbe).done(),
  ])
  controllers.delete(RateProbe)

  // If the send loop failed due to an error, end the payment/quote
  if (typeof probeResult === 'string') {
    await close()
    throw probeResult
  }
  const { rateCalculator, maxPacketAmount } = probeResult

  // Destination asset may not be known until now if it was shared over STREAM vs application layer
  const destinationAccount = controllers.get(AccountController).getDestinationAccount()
  if (!destinationAccount) {
    log.debug('quote failed: receiver never shared destination asset details')
    await close()
    throw PaymentError.UnknownDestinationAsset
  }

  // Determine minimum exchange rate & pull prices from external API
  let externalRate = 1
  if (sourceAccount.assetCode !== destinationAccount.assetCode) {
    const prices =
      options.prices ??
      (await fetchCoinCapRates().catch(async (err) => {
        log.debug('quote failed: error fetching external prices: %s', err) // Note: stringify since axios errors are verbose
        await close()
        throw PaymentError.ExternalRateUnavailable
      }))

    const sourcePrice = prices[sourceAccount.assetCode]
    const destinationPrice = prices[destinationAccount.assetCode]

    // Ensure the prices are defined, finite, and denominator > 0
    if (
      !isNonNegativeNumber(sourcePrice) ||
      !isNonNegativeNumber(destinationPrice) ||
      destinationPrice === 0
    ) {
      log.debug(
        'quote failed: no external rate available from %s to %s',
        sourceAccount.assetCode,
        destinationAccount.assetCode
      )
      await close()
      throw PaymentError.ExternalRateUnavailable
    }

    // This seems counterintuitive because the rate is typically destination amount / source amount
    // However, this is different becaues it's converting source asset -> base currency -> destination asset
    externalRate = sourcePrice / destinationPrice
  }

  const scaledExternalRate =
    externalRate * 10 ** (destinationAccount.assetScale - sourceAccount.assetScale)
  const minimumRate = Ratio.fromNumber((scaledExternalRate * (1 - slippage)) as NonNegativeNumber)
  log.debug('calculated min exchange rate of %s', minimumRate)

  const projectedOutcome = controllers
    .get(AmountController)
    .setPaymentTarget(target.amount, target.type, minimumRate, rateCalculator, maxPacketAmount, log)
  if (isPaymentError(projectedOutcome)) {
    await close()
    throw projectedOutcome
  }

  log.debug('quote complete.')

  // Convert amounts & rates into normalized units
  const shiftRate = (rate: BigNumber) =>
    rate.shiftedBy(-destinationAccount.assetScale).shiftedBy(sourceAccount.assetScale)
  const lowerBoundRate = shiftRate(rateCalculator.lowerBoundRate.toBigNumber())
  const upperBoundRate = shiftRate(rateCalculator.upperBoundRate.toBigNumber())
  const minExchangeRate = shiftRate(minimumRate.toBigNumber())
  const maxSourceAmount = projectedOutcome.maxSourceAmount
    .toBigNumber()
    .shiftedBy(-sourceAccount.assetScale)
  const minDeliveryAmount = projectedOutcome.minDeliveryAmount
    .toBigNumber()
    .shiftedBy(-destinationAccount.assetScale)

  // Estimate how long the payment may take based on max packet amount, RTT, and rate of packet sending
  const packetFrequency = controllers.get(PacingController).getPacketFrequency()
  const estimatedDuration = +projectedOutcome.estimatedNumberOfPackets * packetFrequency

  return {
    sourceAccount,
    destinationAccount,

    invoice: invoice && {
      ...invoice,
      assetCode: destinationAccount.assetCode,
      assetScale: destinationAccount.assetScale,
      amountDelivered: invoice.amountDelivered
        .toBigNumber()
        .shiftedBy(-destinationAccount.assetScale),
      amountToDeliver: invoice.amountToDeliver
        .toBigNumber()
        .shiftedBy(-destinationAccount.assetScale),
    },

    estimatedExchangeRate: [lowerBoundRate, upperBoundRate],
    minExchangeRate,

    maxSourceAmount,
    minDeliveryAmount,

    estimatedDuration,

    pay: async () => {
      log.debug('starting payment.')

      // Start send loop to execute the payment
      const finalState = await connection.runSendLoop()
      await close()

      log.debug('payment ended.')

      return {
        ...(isPaymentError(finalState) && { error: finalState }),

        amountSent: controllers
          .get(AmountController)
          .getAmountSent()
          .toBigNumber()
          .shiftedBy(-sourceAccount.assetScale),
        amountDelivered: controllers
          .get(AmountController)
          .getAmountDelivered()
          .toBigNumber()
          .shiftedBy(-destinationAccount.assetScale),

        sourceAccount,
        destinationAccount,
      }
    },

    cancel: close,
  }
}
