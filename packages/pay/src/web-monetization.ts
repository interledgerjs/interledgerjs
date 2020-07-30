import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import EventEmitter from 'eventemitter3'
import { isPaymentError, PaymentError } from '.'
import { AssetDetails, AssetDetailsController } from './controllers/asset-details'
import { queryAccount } from './open-payments'
import { ControllerMap, StreamController, StreamReply, NextRequest } from './controllers'
import { SequenceController } from './controllers/sequence'
import { FailureController } from './controllers/failure'
import { MaxPacketAmountController } from './controllers/max-packet'
import { PacingController } from './controllers/pacer'
import { PendingRequestTracker } from './controllers/pending-requests'
import {
  SimpleCongestionController,
  CongestionController,
} from './controllers/liquidity-congestion'
import { createConnection } from './connection'
import { Int, PositiveInt, getConnectionLogger, timeout } from './utils'
import {
  StreamMoneyFrame,
  FrameType,
  StreamReceiptFrame,
} from 'ilp-protocol-stream/dist/src/packet'
import { DEFAULT_STREAM_ID } from './controllers/payment'
import { createSendLoop, SendLoop } from './send-loop'
import { ExpiryController } from './controllers/expiry'
import createLogger from 'ilp-logger'

/** Event when additional funds delivered after a packet is fulfilled */
export interface MoneyEvent {
  /** Amount delivered to the recipient payment pointer, in the destination asset and units */
  amount: string
  /** STREAM receipt attesting the amount delivered to a third-party verifier */
  receipt?: string
}

// TODO `SimpleAmountController`, `SendInfinityController` ...
/** TODO explain, rename this? "lossy" "fast + simple" "QuickDirtyAmountController" */
class UnlimitedAmountController implements StreamController {
  private initialPacketAmount: PositiveInt

  public progressEmitter = new EventEmitter<{
    progress: [MoneyEvent]
  }>()

  constructor(initialPacketAmount: PositiveInt) {
    this.initialPacketAmount = initialPacketAmount
  }

  nextState(request: NextRequest, controllers: ControllerMap): void {
    const sourceAmount = (
      controllers.get(MaxPacketAmountController).getNextMaxPacketAmount() ??
      this.initialPacketAmount
    )
      .orLesser(controllers.get(CongestionController).getRemainingInWindow())
      .orLesser(Int.MAX_U64)

    request
      .setSourceAmount(sourceAmount)
      .setMinDestinationAmount(Int.ZERO) // No rate enforcement
      .enableFulfillment()
      .addFrames(new StreamMoneyFrame(DEFAULT_STREAM_ID, 1))
      .send()
  }

  applyRequest() {
    return (reply: StreamReply) => {
      if (!reply.isFulfill() || !reply.destinationAmount) {
        return
      }

      // Since there's no delivery enforcement, no verification of the receipt is possible
      const receipt = reply.frames
        ?.find((frame): frame is StreamReceiptFrame => frame.type === FrameType.StreamReceipt)
        ?.receipt.toString('base64')

      this.progressEmitter.emit('progress', {
        amount: reply.destinationAmount.toString(),
        receipt,
      })
    }
  }
}

// TODO Rename this to something else?
export interface MonetizationStream
  extends EventEmitter<{
      progress: [MoneyEvent]
    }>,
    SendLoop {
  destinationAsset: AssetDetails | undefined
}

export const monetize = async (options: {
  paymentPointer: string
  plugin: Plugin
  initialPacketAmount: number // TODO What type should this be? BigNumber.Value? // Optional, but recommended so an F08 isn't required
  useFarFutureExpiry?: boolean
}): Promise<MonetizationStream> => {
  const { plugin, useFarFutureExpiry } = options

  let log = createLogger('ilp-pay')

  // TODO Can I abstract this into a shared function? Then, no duplicated tests for both `monetize` and `pay`
  const connectResult: PaymentError | void = await timeout(
    10_000,
    plugin.connect().catch((err: Error) => {
      log.error('error connecting plugin:', err)
      return PaymentError.Disconnected
    })
  ).catch(() => {
    log.error('plugin failed to connect: timed out.')
    return PaymentError.Disconnected
  })
  if (isPaymentError(connectResult)) {
    throw connectResult
  }

  const initialPacketAmount = Int.from(options.initialPacketAmount)
  if (
    !initialPacketAmount ||
    !initialPacketAmount.isPositive() ||
    !initialPacketAmount.isLessThanOrEqualTo(Int.MAX_U64)
  ) {
    log.debug('invalid config: initial packet amount is not a positive int in the u64 range')
    throw PaymentError.InvalidSourceAmount // TODO Add a new error type here?
  }

  const credentialsOrError = await queryAccount(options.paymentPointer)
  if (isPaymentError(credentialsOrError)) {
    throw credentialsOrError
  }
  const { sharedSecret, destinationAddress, destinationAsset } = credentialsOrError

  log = await getConnectionLogger(destinationAddress)

  const controllers: ControllerMap = new Map()
    .set(SequenceController, new SequenceController())
    .set(ExpiryController, new ExpiryController(useFarFutureExpiry))
    .set(FailureController, new FailureController())
    .set(MaxPacketAmountController, new MaxPacketAmountController())
    .set(PacingController, new PacingController())
    .set(AssetDetailsController, new AssetDetailsController(destinationAsset))
    .set(CongestionController, new CongestionController()) // TODO
    .set(UnlimitedAmountController, new UnlimitedAmountController(initialPacketAmount))
    .set(PendingRequestTracker, new PendingRequestTracker())

  const sendRequest = await createConnection(plugin, sharedSecret)
  const sendLoop = createSendLoop(sendRequest, controllers, destinationAddress, log)

  const { progressEmitter } = controllers.get(UnlimitedAmountController)

  // Combine the event emitter and send loop into the "monetization stream"
  return Object.assign(progressEmitter, sendLoop, {
    get destinationAsset() {
      return controllers.get(AssetDetailsController).getDestinationAsset()
    },
  })
}
