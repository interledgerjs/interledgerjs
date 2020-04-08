import { FrameType, StreamMaxMoneyFrame } from 'ilp-protocol-stream/dist/src/packet'
import { StreamController, StreamRequest, StreamReply, StreamRequestBuilder } from '.'
import { PaymentState } from '..'
import { SourceAmountTracker } from './source-tracker'
import {
  toBigNumber,
  SAFE_ZERO,
  lessThan,
  Integer,
  multiply,
  subtract,
  add,
  max,
  floor
} from '../utils'
import { DEFAULT_STREAM_ID } from './amount'
import { Maybe } from 'true-myth'
import BigNumber from 'bignumber.js'
import { ExchangeRateController } from './exchange-rate'

// TODO The `remoteReceiveMax` might also be incompatible with the source amount!

// TODO Also, the fixed destination amount could be incompatible with the max source amount,
//      so I should add a check/estimate for that somewhere
//      *** This should probably be a check in `nextState` of the ExchangeRateController
//      Alternatively, maybe it should be here, since other conversions/estimates are here, too

/** Track the delivery amounts and the maximum the recipient can receive. */
export class DestinationAmountTracker implements StreamController {
  /** Maximum amount this stream can receive per `StreamMaxMoney` frames (always increasing). `Nothing` until the frame is received */
  private remoteReceiveMax: Maybe<Integer> = Maybe.nothing()
  /** Fixed amount to deliver to the recipient, in their asset and units. `Nothing` if no fixed destination amount */
  private readonly amountToDeliver: Maybe<Integer>
  /** Sum of all minimum destination amounts currently in-flight, to approximate how much could be delivered */
  private amountInFlight: Integer = SAFE_ZERO
  /** Amount known to be received by the recipient (always increasing) */
  private amountDelivered: Integer = SAFE_ZERO
  /** Source tracker to estimate the amount in-flight */
  private readonly sourceTracker: SourceAmountTracker // TODO This may not be necessary if I use `applyPrepare`
  /** TODO rate */
  private readonly rateController: ExchangeRateController

  constructor(
    sourceTracker: SourceAmountTracker,
    rateController: ExchangeRateController,
    amountToDeliver: Maybe<Integer> = Maybe.nothing()
  ) {
    this.sourceTracker = sourceTracker
    this.rateController = rateController
    this.amountToDeliver = amountToDeliver
  }

  nextState({ log }: StreamRequestBuilder) {
    if (this.didOverpay()) {
      log.error(
        'ending payment: overpaid fixed destination amount. delivered %s of %s',
        this.amountDelivered,
        this.amountToDeliver
      )
      return PaymentState.End
    }

    if (this.isComplete()) {
      log.debug(
        'payment complete: paid fixed destination amount. delivered %s',
        this.amountDelivered
      )
      return PaymentState.End
    }

    if (this.isReceiveMaxIncompatible()) {
      log.error(
        'ending payment: fixed destination amount is too much for recipient. amount to deliver: %s, receive max: %s',
        this.amountToDeliver,
        this.remoteReceiveMax
      )
      return PaymentState.End
    }

    if (this.isBlocked()) {
      return PaymentState.Wait
    }

    return PaymentState.SendMoney
  }

  getAmountToDeliver(): Maybe<Integer> {
    return this.amountToDeliver
  }

  /** Amount fulfilled and delivered to the recipient in destination units */
  getAmountDelivered(): Integer {
    return this.amountDelivered
  }

  /**
   * Remaining amount in destination units needed to satisfy the fixed destination amount,
   * or `Nothing` if no fixed destination amount.
   */
  getRemainingToDeliver(): Maybe<Integer> {
    return this.amountToDeliver
      .map(subtract)
      .ap(Maybe.just(this.amountDelivered))
      .chain(n => n)
  }

  /**
   * High-end estimated remaining amount (in source units) needed to satisfy
   * the fixed destination amount, or `Nothing` if no fixed destination amount.
   */
  getRemainingToSend(): Maybe<Integer> {
    return this.rateController.estimateHighEndSourceAmount(this.getRemainingToDeliver())
  }

  // TODO Should this add some % to this, just in case the rate turns out to be better than expected?
  // TODO Track each hold separately on `applyPrepare`?

  /** Optimistic amount all in-flight packets might deliver, in destination units */
  estimateAmountInFlight(): Maybe<Integer> {
    const exchangeRate = this.rateController.getRateUpperBound()
    const sourceAmountInFlight = this.sourceTracker.getAmountInFlight()

    const highEstimatedAmountInFlight = Maybe.just(sourceAmountInFlight)
      .map(multiply)
      .ap(Maybe.just(exchangeRate))
      .map(floor)

    return max([this.amountInFlight, highEstimatedAmountInFlight.unwrapOr(SAFE_ZERO)])
  }

  /**
   * Amount in destination units that can safely be delivered without overpaying,
   * or `Nothing` if no fixed destination amount.
   */
  getAvailableToDeliver(): Maybe<Integer> {
    return this.getRemainingToDeliver()
      .map(subtract)
      .ap(this.estimateAmountInFlight())
      .chain(n => Maybe.just(n.unwrapOr(SAFE_ZERO))) // If underflow, default to 0
  }

  /**
   * Amount in source units that can safely be sent without overpaying the fixed
   * destination amount, or `Nothing` if no fixed destination amount.
   */
  getAvailableToSend(): Maybe<Integer> {
    return this.rateController.estimateLowEndSourceAmount(this.getAvailableToDeliver())
  }

  /** Would sending any more money risk overpayment? */
  private isBlocked(): boolean {
    return this.getAvailableToDeliver()
      .map(n => n.isZero())
      .unwrapOr(false)
  }

  /** Did we pay more than the fixed destination amount? */
  private didOverpay(): boolean {
    return this.amountToDeliver.map(n => this.amountDelivered.isGreaterThan(n)).unwrapOr(false)
  }

  /** Did we pay exactly the fixed destination amount? */
  private isComplete(): boolean {
    const paidFullAmount = this.amountToDeliver.mapOr(false, n => n.isEqualTo(this.amountDelivered))
    const noOverPaymentRisk = this.estimateAmountInFlight().mapOr(false, n => n.isZero())
    return paidFullAmount && noOverPaymentRisk
  }

  /** Is the recipient's advertised `receiveMax` less than the fixed destination amount? */
  private isReceiveMaxIncompatible() {
    return this.remoteReceiveMax
      .map(lessThan)
      .ap(this.amountToDeliver)
      .unwrapOr(false)
  }

  applyPrepare({ minDestinationAmount }: StreamRequest) {
    this.amountInFlight = add(this.amountInFlight)(minDestinationAmount)
  }

  applyFulfill(reply: StreamReply) {
    // Delivered amount must be *at least* the minimum acceptable amount we told the receiver
    // No matter what, since they fulfilled it, we must assume they got at least the minimum
    const { minDestinationAmount, destinationAmount } = reply
    const amountDelivered = BigNumber.max(
      minDestinationAmount,
      destinationAmount || SAFE_ZERO
    ) as Integer
    this.amountDelivered = add(this.amountDelivered)(amountDelivered)

    this.removeHold(reply)
    this.updateRemoteReceived(reply)
  }

  applyReject(reply: StreamReply) {
    this.removeHold(reply)
    this.updateRemoteReceived(reply)
  }

  private removeHold({ minDestinationAmount }: StreamReply) {
    this.amountInFlight = subtract(this.amountInFlight)(minDestinationAmount).unwrapOr(SAFE_ZERO)
  }

  private updateRemoteReceived({ responseFrames, log }: StreamReply) {
    if (!responseFrames) {
      return
    }

    responseFrames
      .filter((frame): frame is StreamMaxMoneyFrame => frame.type === FrameType.StreamMaxMoney)
      .filter(frame => frame.streamId.equals(DEFAULT_STREAM_ID))
      .map(frame => {
        log.trace(
          'peer told us this stream can receive up to: %s and has received: %s so far',
          frame.receiveMax,
          frame.totalReceived
        )

        // TODO Remove casts!
        const totalReceived = toBigNumber(frame.totalReceived) as Integer
        const receiveMax = toBigNumber(frame.receiveMax) as Integer

        this.amountDelivered = BigNumber.max(this.amountDelivered, totalReceived) as Integer
        this.remoteReceiveMax = max([receiveMax, this.remoteReceiveMax.unwrapOr(SAFE_ZERO)])
      })
  }
}
