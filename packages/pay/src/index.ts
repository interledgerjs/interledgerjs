import BigNumber from 'bignumber.js'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { ControllerMap } from './controllers'
import { AccountController, AccountDetails } from './controllers/asset-details'
import { PendingRequestTracker } from './controllers/pending-requests'
import { getRate } from './rates'
import { fetchCoinCapRates } from './rates/coincap'
import { Integer, isInteger } from './utils'
import { query, isStreamCredentials } from './setup/spsp'
import { IlpAddress, areSchemesCompatible, isValidIlpAddress } from './setup/shared'
import { AssetScale, isValidAssetScale } from './setup/open-payments'
import { AmountController, PaymentTarget, PaymentType } from './controllers/amount'
import { ExchangeRateController, isValidSlippage } from './controllers/exchange-rate'
import { SequenceController } from './controllers/sequence'
import { PacingController } from './controllers/pacer'
import { FailureController } from './controllers/failure'
import { MaxPacketAmountController } from './controllers/max-packet'
import { createConnection } from './connection'
import { RateProbe } from './controllers/rate-probe'
import { fetch as sendIldcpRequest } from 'ilp-protocol-ildcp'

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
  getExpiry?: (destination: string) => Date
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
  /** Probed exchange rate over the path: range of [minimum, maximum] */
  estimatedExchangeRate: [BigNumber, BigNumber]
  /** Minimum exchange rate used to enforce rates */
  minExchangeRate: BigNumber
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
  /** Amount in-flight and yet to be fulfilled or rejected, in normalized source units with arbitrary precision */
  amountInFlight: BigNumber
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

  /**
   * Miscellaneous errors
   */

  /** Rate probe failed to establish the realized exchange rate */
  RateProbeFailed = 'RateProbeFailed',
  /** Send more than intended: paid more than the fixed source amount of the payment */
  OverpaidFixedSend = 'OverpaidFixedSend',
  /** Failed to fulfill a packet before payment timed out */
  IdleTimeout = 'IdleTimeout',
  /** Encountered an ILP Reject packet with a final error that cannot be retried */
  TerminalReject = 'TerminalReject',
  /** Sent too many packets with this encryption key and must close the connection */
  ExceededMaxSequence = 'ExceededMaxSequence',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isPaymentError = (o: any): o is PaymentError => Object.values(PaymentError).includes(o)

/**
 * Quote and prepare to perform a payment:
 * - Query the recipient's payment pointer, if provided
 * - Ensure viable payment path to recipient
 * - Probe the realized rate to the recipient
 * - Prepare to enforce exchange rate by comparing against
 *   rates pulled from external sources
 */
export const quote = async (options: PaymentOptions): Promise<Quote> => {
  const { plugin, getExpiry } = options

  // Resolve the payment payment and/or validate STREAM credentials
  const credentials = options.paymentPointer ? await query(options.paymentPointer) : options
  if (!isStreamCredentials(credentials)) {
    throw PaymentError.InvalidCredentials
  }
  const { destinationAddress, sharedSecret } = credentials

  // Validate the slippage
  const slippage = options.slippage ?? ExchangeRateController.DEFAULT_SLIPPAGE
  if (!isValidSlippage(slippage)) {
    throw PaymentError.InvalidSlippage
  }

  // TODO Log here that the quote is starting?

  await plugin.connect().catch(() => {
    throw PaymentError.Disconnected
  })

  // Fetch asset details of source account
  const sourceAccount: AccountDetails = await sendIldcpRequest((data) => plugin.sendData(data))
    .catch(() => {
      throw PaymentError.UnknownSourceAsset
    })
    .then(({ assetCode, assetScale, clientAddress }) => {
      if (!isValidAssetScale(assetScale) || !isValidIlpAddress(clientAddress)) {
        throw PaymentError.UnknownSourceAsset
      }

      return {
        assetCode,
        assetScale,
        ilpAddress: clientAddress,
      }
    })

  // Sanity check to ensure sender and receiver use the same network/prefix
  if (!areSchemesCompatible(sourceAccount.ilpAddress, destinationAddress)) {
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
    getExpiry
  )

  // Validate the fixed sent amount or fixed destination amount:
  // - Convert from normal units into scaled units
  // - Ensure the account is precise enough for the given denomination
  // - For fixed destination payments, set the destination asset details
  let target: PaymentTarget
  if (typeof options.amountToSend !== 'undefined') {
    const adjustedAmount = new BigNumber(options.amountToSend).shiftedBy(sourceAccount.assetScale)
    if (!isInteger(adjustedAmount) || !adjustedAmount.isGreaterThan(0)) {
      await connection.close()
      throw PaymentError.InvalidSourceAmount
    }

    target = {
      type: PaymentType.FixedSend,
      amountToSend: adjustedAmount as Integer,
    }
  } else if (typeof options.amountToDeliver !== 'undefined') {
    // Invoices require a known destination asset
    const { destinationAssetCode: assetCode, destinationAssetScale: assetScale } = options
    if (!assetCode || !isValidAssetScale(assetScale)) {
      await connection.close()
      throw PaymentError.UnknownDestinationAsset
    }

    controllers.get(AccountController).setDestinationAsset(assetCode, assetScale)

    const adjustedAmount = new BigNumber(options.amountToDeliver).shiftedBy(assetScale)
    if (!isInteger(adjustedAmount) || !adjustedAmount.isGreaterThan(0)) {
      await connection.close()
      throw PaymentError.InvalidDestinationAmount
    }

    target = {
      type: PaymentType.FixedDelivery,
      amountToDeliver: adjustedAmount,
    }
  } else {
    await connection.close()
    throw PaymentError.UnknownPaymentTarget
  }

  // Send test packets
  // - Fetch asset details from the recipient
  // - Ensure the recipient is routable
  // - Probe the realized exchange rate
  // - Discover path max packet amount
  const result = await connection.runSendLoop()

  // If the send loop failed due to an error, end the payment/quote
  if (isPaymentError(result)) {
    await connection.close()
    throw result
  }

  controllers.get(RateProbe).disable()

  // Pull exchange rate from external API to determine the minimum exchange rate
  // TODO This should have a timeout attached to it
  const prices =
    options.prices ??
    (await fetchCoinCapRates().catch(async () => {
      await connection.close()
      throw PaymentError.ExternalRateUnavailable
    }))

  const destinationAccount = controllers.get(AccountController).getDestinationAccount()
  if (!destinationAccount) {
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
    await connection.close()
    throw PaymentError.ExternalRateUnavailable
  }

  // Enforce a minimum exchange rate
  connection.log.extend('rate').debug('setting min exchnage rate to %s', externalRate) // TODO Remove
  const minRateOrErr = controllers
    .get(ExchangeRateController)
    .setMinExchangeRate(externalRate, slippage)
  if (isPaymentError(minRateOrErr)) {
    await connection.close()
    throw minRateOrErr
  }

  // TODO 1. Check that amount to send is compatible with receiveMax
  // TODO 2. Estimate the amount that will get delivered...
  //         and if that's less than the fixed delivery amount, fail!
  //         (if minRate = 0 or slippage = 1, destination amount payment isn't possible!)
  controllers.get(AmountController).setPaymentTarget(target)

  const lowerRate = controllers.get(ExchangeRateController).getRateLowerBound()
  const upperRate = controllers.get(ExchangeRateController).getRateUpperBound()
  if (!lowerRate || !upperRate) {
    await connection.close()
    throw PaymentError.RateProbeFailed
  }

  const maxSourceAmount = (target.type === PaymentType.FixedSend
    ? target.amountToSend
    : target.amountToDeliver.dividedBy(minRateOrErr).integerValue(BigNumber.ROUND_CEIL)
  )
    .shiftedBy(-sourceAccount.assetScale)
    .decimalPlaces(sourceAccount.assetScale)

  connection.log.debug('quote complete.')

  const shiftRate = (rate: BigNumber) =>
    rate.shiftedBy(-destinationAccount.assetScale).shiftedBy(sourceAccount.assetScale)

  return {
    sourceAccount,
    destinationAccount,
    estimatedExchangeRate: [shiftRate(lowerRate), shiftRate(upperRate)],
    minExchangeRate: shiftRate(minRateOrErr),
    maxSourceAmount,

    // TODO Add *accurate* estimated delivery and estimated source amount ranges
    //      Maybe use upper bound rate and min exchange rate to compute this?

    pay: async () => {
      connection.log.debug('starting payment.')

      // Start send loop to execute the payment
      const finalState = await connection.runSendLoop()
      await connection.close()

      connection.log.debug('payment ended.')

      return {
        ...(isPaymentError(finalState) && { error: finalState }),
        // Amounts sent & delivered
        ...controllers
          .get(AmountController)
          .generateReceipt(sourceAccount.assetScale, destinationAccount.assetScale),
        // Asset details
        sourceAccount,
        destinationAccount,
      }
    },

    cancel: () => connection.close(),
  }
}
