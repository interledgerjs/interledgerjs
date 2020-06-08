import BigNumber from 'bignumber.js'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { ControllerMap } from './controllers'
import { AccountController, AccountDetails } from './controllers/asset-details'
import { PendingRequestTracker } from './controllers/pending-requests'
import { getRate } from './rates'
import { fetchCoinCapRates } from './rates/coincap'
import { query, isStreamCredentials } from './setup/spsp'
import { IlpAddress, isValidIlpAddress, getScheme } from './setup/shared'
import { AssetScale, isValidAssetScale } from './setup/open-payments'
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
  Int,
  Ratio,
  PositiveInt,
  isNonNegativeNumber,
  NonNegativeNumber,
} from './utils'
import createLogger from 'ilp-logger'

/** Parameters to setup and prepare a payment */
export interface PaymentOptions {
  /** Plugin to send (and optionally, receive) ILP packets over the network */
  plugin: Plugin
  /** Payment pointer in "$" format or SPSP URL to resolve STREAM credentials */
  paymentPointer?: string
  /** ILP address of the recipient of the payment, from the STREAM server. Requires `sharedSecret` */
  destinationAddress?: string
  /** Shared secret from the STREAM server, as raw Buffer or base64 encoded string. Requires `destinationAddress` */
  sharedSecret?: Buffer
  /** Fixed amount to send to the recipient, in normalized source units with arbitrary precision */
  amountToSend?: BigNumber.Value
  /** Fixed amount to deliver to the recipient, in normalized destination units with arbitrary precision */
  amountToDeliver?: BigNumber.Value
  /** 3-4 character asset code or symbol the invoice is denominated in. Required for fixed delivery */
  destinationAssetCode?: string
  /** Asset scale the invoice is denominated in. Require for fixed delivery */
  destinationAssetScale?: number
  /** Percentage to subtract from an external exchange rate to determine the minimum acceptable exchange rate */
  slippage?: number
  /** Callback to set the expiration timestamp of each packet given the destination ILP address */
  getExpiry?: (destination?: string) => Date
  /**
   * Set of asset codes -> price in a standardized base asset, to calculate exchange rates.
   * By default, rates will be pulled from the CoinCap API
   */
  prices?: {
    [assetCode: string]: number
  }
}

/** Parameters of payment execution and the projected outcome of a payment */
export interface Quote {
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
  sourceAccount: {
    ilpAddress: IlpAddress
    assetScale: AssetScale
    assetCode: string
  }
  /** Destination account details */
  destinationAccount: {
    ilpAddress: IlpAddress
    assetScale: AssetScale
    assetCode: string
  }
  /** Execute the payment within these parameters */
  pay: () => Promise<Receipt>
  /** Cancel the payment (disconnects the plugin and closes connection with recipient) */
  cancel: () => Promise<void>
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
  sourceAccount: {
    ilpAddress: IlpAddress
    assetScale: AssetScale
    assetCode: string
  }
  /** Destination account details */
  destinationAccount: {
    ilpAddress: IlpAddress
    assetScale: AssetScale
    assetCode: string
  }
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
  IncompatibleIntegerledgerNetworks = 'IncompatibleIntegerledgerNetworks',
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

  /** Failed to query the SPSP server or received an invalid response */
  SpspQueryFailed = 'SpspQueryFailed',
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
  /** Encountered an ILP Reject packet with a final error that cannot be retried */
  TerminalReject = 'TerminalReject',
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

  // Resolve the payment payment and/or validate STREAM credentials
  const credentials = options.paymentPointer ? await query(options.paymentPointer) : options
  if (!isStreamCredentials(credentials)) {
    log.debug('invalid config: shared secret or destination address missing or invalid')
    throw PaymentError.InvalidCredentials
  }
  const { destinationAddress, sharedSecret } = credentials

  const connectionId = await getConnectionId(destinationAddress)
  log = log.extend(connectionId)

  // Validate the slippage
  const slippage = options.slippage ?? 0.01
  if (!isNonNegativeNumber(slippage) || slippage > 1) {
    log.debug('invalid config: slippage is not a number between 0 and 1')
    throw PaymentError.InvalidSlippage
  }

  // TODO Ensure the plugin is disconnected after all errors!

  await plugin.connect().catch((err: Error) => {
    log.debug('error connecting plugin:', err)
    throw PaymentError.Disconnected
  })

  // Fetch asset details of source account
  const sourceAccount: AccountDetails = await sendIldcpRequest((data) => plugin.sendData(data))
    .catch(() => {
      log.debug('quote failed: unknown source asset after IL-DCP request failed')
      throw PaymentError.UnknownSourceAsset
    })
    .then(({ assetCode, assetScale, clientAddress }) => {
      if (!isValidAssetScale(assetScale) || !isValidIlpAddress(clientAddress)) {
        log.debug('quote failed: source asset details from IL-DCP request are invalid')
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
    throw PaymentError.IncompatibleIntegerledgerNetworks
  }

  const controllers: ControllerMap = new Map()
  controllers
    // First so all other controllers log the sequence number
    .set(SequenceController, new SequenceController())
    // Fail-fast on Fxx errors or timeouts
    .set(FailureController, new FailureController())
    // Fail-fast if destination asset detail conflict
    .set(AccountController, new AccountController(sourceAccount, destinationAddress))
    .set(PacingController, new PacingController())
    .set(MaxPacketAmountController, new MaxPacketAmountController())
    .set(AmountController, new AmountController(controllers))
    .set(ExchangeRateController, new ExchangeRateController())
    .set(RateProbe, new RateProbe(controllers))
    // Ensure packet is processed by each controller before pending request Promises resolve
    .set(PendingRequestTracker, new PendingRequestTracker())

  // Register handlers for incoming packets and generate encryption keys
  const connection = await createConnection(
    plugin,
    controllers,
    sharedSecret,
    destinationAddress,
    options.getExpiry
  )

  // Perform initial validation of the target amount
  let targetAmount: PositiveInt
  let targetType: PaymentType
  if (typeof options.amountToSend !== 'undefined') {
    const amountToSend = Int.fromBigNumber(
      new BigNumber(options.amountToSend).shiftedBy(sourceAccount.assetScale)
    )
    if (!amountToSend || !amountToSend.isPositive()) {
      log.debug(
        'invalid config: fixed source amount is not a positive integer or more precise than the source account'
      )
      await connection.close()
      throw PaymentError.InvalidSourceAmount
    }

    targetAmount = amountToSend
    targetType = PaymentType.FixedSend
  } else if (typeof options.amountToDeliver !== 'undefined') {
    const { destinationAssetCode: assetCode, destinationAssetScale: assetScale } = options
    if (!assetCode || !isValidAssetScale(assetScale)) {
      log.debug(
        'invalid config: destination asset details must be provided in advance for fixed delivery payments'
      )
      await connection.close()
      throw PaymentError.UnknownDestinationAsset
    }

    controllers.get(AccountController).setDestinationAsset(assetCode, assetScale)

    const amountToDeliver = Int.fromBigNumber(
      new BigNumber(options.amountToDeliver).shiftedBy(assetScale)
    )
    if (!amountToDeliver || !amountToDeliver.isPositive()) {
      log.debug(
        'invalid config: fixed delivery amount is not a positive integer or more precise than the destination account'
      )
      await connection.close()
      throw PaymentError.InvalidDestinationAmount
    }

    targetAmount = amountToDeliver
    targetType = PaymentType.FixedDelivery
  } else {
    log.debug('invalid config: no fixed source or destination amount was provided')
    await connection.close()
    throw PaymentError.UnknownPaymentTarget
  }

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

  // If the send loop failed due to an error, end the payment/quote
  if (typeof probeResult === 'string') {
    await connection.close()
    throw probeResult
  }

  controllers.delete(RateProbe)

  // Pull exchange rate from external API to determine the minimum exchange rate
  const prices =
    options.prices ??
    (await fetchCoinCapRates().catch(async (err) => {
      log.debug('quote failed: error fetching external prices: %s', err) // Note: stringify since axios errors are verbose
      await connection.close()
      throw PaymentError.ExternalRateUnavailable
    }))

  const destinationAccount = controllers.get(AccountController).getDestinationAccount()
  if (!destinationAccount) {
    log.debug('quote failed: receiver never shared destination asset details')
    await connection.close()
    throw PaymentError.UnknownDestinationAsset
  }

  // Convert into the appropriate scaled units
  const externalRate = getRate(
    sourceAccount.assetCode,
    sourceAccount.assetScale,
    destinationAccount.assetCode,
    destinationAccount.assetScale,
    prices
  )
  if (!externalRate) {
    log.debug(
      'quote failed: no external rate available from %s to %s',
      sourceAccount.assetCode,
      destinationAccount.assetCode
    )
    await connection.close()
    throw PaymentError.ExternalRateUnavailable
  }

  const minimumRate = Ratio.fromNumber((externalRate * (1 - slippage)) as NonNegativeNumber)
  log.debug('calculated min exchange rate of %s', minimumRate)

  const { rateCalculator, maxPacketAmount } = probeResult

  const projectedOutcome = controllers
    .get(AmountController)
    .setPaymentTarget(targetAmount, targetType, minimumRate, rateCalculator, maxPacketAmount, log)
  if (isPaymentError(projectedOutcome)) {
    await connection.close()
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

    estimatedExchangeRate: [lowerBoundRate, upperBoundRate],
    minExchangeRate,

    maxSourceAmount,
    minDeliveryAmount,

    estimatedDuration,

    pay: async () => {
      log.debug('starting payment.')

      // Start send loop to execute the payment
      const finalState = await connection.runSendLoop()
      await connection.close()

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

    cancel: () => connection.close(),
  }
}
