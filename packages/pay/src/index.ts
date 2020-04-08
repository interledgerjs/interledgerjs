import BigNumber from 'bignumber.js'
import createLogger from 'ilp-logger'
import {
  generateFulfillmentKey,
  generatePskEncryptionKey
} from 'ilp-protocol-stream/dist/src/crypto'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { Maybe } from 'true-myth'
import {
  isNextStateController,
  isPrepareController,
  StreamController,
  StreamRequestBuilder
} from './controllers'
import { AmountStrategy } from './controllers/amount'
import { DestinationAmountTracker } from './controllers/destination-tracker'
import { ExchangeRateController } from './controllers/exchange-rate'
import { FailureController } from './controllers/failure'
import { SimpleCongestionController } from './controllers/liquidity-congestion'
import { MaxPacketAmountController } from './controllers/max-packet'
import { PacingController } from './controllers/pacer'
import { PendingRequestTracker } from './controllers/pending-requests'
import { SequenceController } from './controllers/sequence'
import { SourceAmountTracker } from './controllers/source-tracker'
import { DEFAULT_DATA_HANDLER, getDefaultExpiry, sendPacket, StreamConnection } from './send-packet'
import { getConnectionId, Integer, timeout, Rational } from './utils'

// TODO Implement quoting flow
// TODO Change to normalized units with decimal point

export interface PayOptions {
  amountToSend?: BigNumber
  amountToDeliver?: BigNumber
  sourceAddress: string
  sourceAssetCode: string
  sourceAssetScale: number
  destinationAddress: string
  destinationAssetCode: string
  destinationAssetScale: number
  sharedSecret: Buffer
  exchangeRate: BigNumber
  plugin: Plugin
  getExpiry?: (destination: string) => Date
}

export interface StreamReceipt {
  amountToSend?: BigNumber
  amountSent: BigNumber
  amountInFlight: BigNumber
  sourceAddress: string
  sourceAssetCode: string
  sourceAssetScale: number
  amountToDeliver?: BigNumber
  amountDelivered: BigNumber
  destinationAddress: string
  destinationAssetCode: string
  destinationAssetScale: number
}

/** Next state as signaled by each controller */
export enum PaymentState {
  /** Ready to send money and apply the next ILP Prepare */
  SendMoney,
  /** Temporarily pause sending money until any request finishes or some time elapses */
  Wait,
  /** Stop the payment */
  End
}

export const pay = async (options: PayOptions): Promise<StreamReceipt> => {
  const connection: StreamConnection = {
    destinationAddress: options.destinationAddress,
    plugin: options.plugin,
    pskKey: await generatePskEncryptionKey(options.sharedSecret),
    fulfillmentKey: await generateFulfillmentKey(options.sharedSecret),
    getExpiry: options.getExpiry || getDefaultExpiry
  }

  connection.plugin.registerDataHandler(DEFAULT_DATA_HANDLER)
  await connection.plugin.connect()

  const log = createLogger(`ilp-pay:payment:${getConnectionId(options.destinationAddress)}`)

  const rateController = new ExchangeRateController(options.exchangeRate as Rational)
  const sourceTracker = new SourceAmountTracker(Maybe.fromNullable(options.amountToSend as Integer)) // TODO no cast
  const destinationTracker = new DestinationAmountTracker(
    sourceTracker,
    rateController,
    Maybe.fromNullable(options.amountToDeliver as Integer) // TODO no cast
  )
  const pacingController = new PacingController()
  const congestionController = new SimpleCongestionController(pacingController)
  const maxPacketController = new MaxPacketAmountController()
  const sequenceController = new SequenceController()
  const failureController = new FailureController()
  const pendingTracker = new PendingRequestTracker()
  const amountStrategy = new AmountStrategy(
    sourceTracker,
    destinationTracker,
    maxPacketController,
    congestionController,
    rateController,
    options.exchangeRate as Rational // TODO no cast
  )

  // TODO After quoting flow is implemented, add `AssetDetailsController` here, too
  const controllers: StreamController[] = [
    sequenceController, // Sequence first for logging for all other controllers
    failureController,
    pacingController,
    congestionController, // TODO Unnecessary when applying prepare?
    pendingTracker,
    sourceTracker, // Source & destination trackers before amount strategy in case we're blocked from sending money
    destinationTracker,
    amountStrategy,
    maxPacketController, // TODO Unnecessary when applying prepare?
    rateController // TODO Unnecessary when applying prepare?
  ]

  sendLoop: for (;;) {
    // Ask each controller what the next state should be
    const builder = new StreamRequestBuilder(log)
    const nextState = controllers.filter(isNextStateController).reduce(
      // Short-circuit if any controller cannot send money
      (state, c) => (state !== PaymentState.SendMoney ? state : c.nextState(builder)),
      PaymentState.SendMoney
    )
    const request = builder.build()

    switch (nextState) {
      case PaymentState.SendMoney:
        // `nextState` and `applyPrepare` run synchronously
        controllers.filter(isPrepareController).forEach(c => c.applyPrepare(request))
        sendPacket(connection, controllers, request)
        continue sendLoop

      case PaymentState.Wait:
        await timeout(5, Promise.race(pendingTracker.getPendingRequests()))
        continue sendLoop

      case PaymentState.End:
        // TODO Should this send a `ConnectionClose` frame? (Server destroys connection after idle timer)
        await Promise.all(pendingTracker.getPendingRequests())
        break sendLoop
    }
  }

  await connection.plugin
    .disconnect()
    .then(() => log.debug('plugin disconnected'))
    .catch((err: Error) => log.error('error disconnecting plugin:', err))

  return {
    // TODO Add success/failure to this output (did it deliver the target with no remaining in flight?)

    // Source amounts
    amountToSend: options.amountToSend,
    amountInFlight: sourceTracker.getAmountInFlight(),
    amountSent: sourceTracker.getAmountSent(),
    sourceAddress: options.sourceAddress,
    sourceAssetCode: options.sourceAssetCode,
    sourceAssetScale: options.sourceAssetScale,
    // Destination amounts
    amountToDeliver: options.amountToDeliver,
    amountDelivered: destinationTracker.getAmountDelivered(),
    destinationAddress: options.destinationAddress,
    destinationAssetCode: options.destinationAssetCode,
    destinationAssetScale: options.destinationAssetScale
  }
}
