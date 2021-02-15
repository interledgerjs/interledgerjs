import { RequestState, StreamSender, SenderContext, SendState } from '.'
import { Ratio, Int, PositiveInt } from '../utils'
import {
  StreamMaxMoneyFrame,
  FrameType,
  StreamMoneyFrame,
  StreamReceiptFrame,
} from 'ilp-protocol-stream/dist/src/packet'
import { MaxPacketAmountController } from './max-packet'
import { ExchangeRateCalculator, ExchangeRateController } from './exchange-rate'
import { PaymentError, Receipt } from '..'
import { Logger } from 'ilp-logger'
import { StreamReply } from '../request'
import { PacingController } from './pacer'
import { AssetDetailsController } from './asset-details'
import { TimeoutController } from './timeout'
import { FailureController } from './failure'
import { ExpiryController } from './expiry'
import { EstablishmentController } from './establishment'
import { SequenceController } from './sequence'
import { decodeReceipt, Receipt as StreamReceipt } from 'ilp-protocol-stream'

export enum PaymentType {
  FixedSend,
  FixedDelivery,
}

/** Amount and exchange rate conditions that must be met for the payment to complete */
interface PaymentTarget {
  type: PaymentType
  maxSourceAmount: PositiveInt
  minDeliveryAmount: Int
  minExchangeRate: Ratio
  rateCalculator: ExchangeRateCalculator
  sourceRoundingError: Int
}

/** Controller to track the payment status and compute amounts to send and deliver */
export class PaymentController implements StreamSender<Receipt> {
  static DEFAULT_STREAM_ID = 1

  /** Total amount sent and fulfilled, in scaled units of the sending account */
  private amountSent = Int.ZERO

  /** Total amount delivered and fulfilled, in scaled units of the receiving account */
  private amountDelivered = Int.ZERO

  /** Amount sent that is yet to be fulfilled or rejected, in scaled units of the sending account */
  private sourceAmountInFlight = Int.ZERO

  /** Estimate of the amount that may be delivered from in-flight packets, in scaled units of the receiving account */
  private destinationAmountInFlight = Int.ZERO

  /** Remaining amount allowed to be lost to rounding below the enforced exchange rate, in destination units */
  private availableDeliveryShortfall: Int

  /** Maximum amount the recipient can receive on the default stream */
  private remoteReceiveMax?: Int

  /** Greatest STREAM receipt and amount, to prove delivery to a third-party verifier */
  private latestReceipt?: {
    totalReceived: Int
    buffer: Buffer
  }

  readonly order = [
    SequenceController,
    EstablishmentController,
    ExpiryController,
    FailureController,
    TimeoutController,
    MaxPacketAmountController,
    AssetDetailsController,
    PacingController,
    ExchangeRateController,
  ]

  constructor(
    /** Conditions that must be met for the payment to complete, and parameters of its execution */
    private readonly target: PaymentTarget,

    /** Callback to pass updates as packets are sent and received */
    private readonly progressHandler?: (status: Receipt) => void
  ) {
    // Reliably deliver of the final packet by tolerating a small destination amount, below the
    // enforced exchange rate, to be lost to rounding.
    // TODO This represents an amount NOT delivered, but should it be floored or ceiled?

    // TODO I think this probably needs to be ceiled, but I'm not sure I have a test case that adequately tests this
    this.availableDeliveryShortfall = target.sourceRoundingError.multiplyCeil(
      target.minExchangeRate
    )
  }

  static createPaymentTarget(
    targetAmount: PositiveInt,
    targetType: PaymentType,
    minExchangeRate: Ratio,
    rateCalculator: ExchangeRateCalculator,
    maxSourcePacketAmount: Int,
    log: Logger
  ): PaymentTarget | PaymentError {
    const { lowerBoundRate, upperBoundRate } = rateCalculator
    if (!lowerBoundRate.isPositive()) {
      log.debug('quote failed: probed exchange rate is 0')
      return PaymentError.InsufficientExchangeRate
    }

    // TODO Change this
    // Tolerate up to 1 source unit, converted into destination units, to be lost, below the enforced
    // minimum destination amounts. This enables reliable delivery of the final payment packet.
    // Clean up this comment
    // Add note that this also helps account for intermediary rounding error
    // Quantity of source units *allowed* to be lost to rounding during the payment.
    // If a packet is sent with too low of an amount, the amount lost to rounding,
    // at each hop, is 1 unit of the local asset before the conversion.
    // Tolerate one packet rounding error from source unit to next hop
    const sourceRoundingError = Int.ONE

    // In some cases, e.g., if the minimum rate is an exact integer (so long as probed rate >= minRate),
    // rounding errors from the initial conversion are not possible, so the subsequent checks aren't necessary.
    // For example, this enables a 1:1 minimum rate and 1:1 probed rate to succeed.
    // TODO lowerBoundRate or upperBoundRate ?
    const isRoundingErrorPossible = !lowerBoundRate
      .floor()
      .isGreaterThanOrEqualTo(minExchangeRate.ceil())
    if (isRoundingErrorPossible) {
      /**
       * TODO alternative logic here:
       *
       * maxPacketAmount.orLesser(maxSourceAmount)
       * ---> projectedDestinationAmount (TODO Compare lower bound rate or upper bound rate?)
       * ---> minDestinationAmount (via minRate)
       *
       * if (projected < min) {
       *    ExchangeRateError
       * }
       *
       * TODO Maybe comapre the source amount to the amount in the ratio?
       * e.g., if the probed packet amounts are less than the max packet amount, use upper bound rate,
       *       otherwise, use lower bound rate...?
       *
       * But does this check if the final packet will work?
       */

      // TODO Changed this to upperBoundRate... is that good or bad?
      //      Note: it's **rounding errors** that create the difference
      //      between the upper and lower bound rate. So, when calculating the acceptable
      //      rounding error/min packet amount, it should first assume no rounding error
      //      occurs, right?

      // Note: it is **rounding errors** that cause the different between the upper and lower
      // bound rates. So, while checking if the max packet amount is large enough to accomodate a
      // rounding error, use the optimistic rate since we know if didn't round down.

      // TODO ...

      const marginOfError = upperBoundRate.subtract(minExchangeRate)
      if (!marginOfError.isPositive()) {
        log.debug(
          'quote failed: probed exchange rate of %s does not exceed minimum of %s',
          upperBoundRate,
          minExchangeRate
        )
        return PaymentError.InsufficientExchangeRate
      }

      // Even if the real exchange rate is better than the sender's minimum rate, sometimes the actual destination
      // amount won't exceed the minimum destination amount, and a packet will fail due to a rounding error.
      // This is because intermediaries round down, but senders round up:
      // Determined by intermediaries ---> realDestinationAmount = floor(sourceAmount * realExchangeRate)
      // Determined by senders        ---> minDestinationAmount  =  ceil(sourceAmount * minExchangeRate)

      // Packets that aren't at least this minimum source amount *may* fail due to rounding.
      // If the max packet does doesn't allow sufficient precision, fail fast, since the payment is unlikely to succeed.
      const minSourcePacketAmount = marginOfError.reciprocal().ceil()
      if (!maxSourcePacketAmount.isGreaterThanOrEqualTo(minSourcePacketAmount)) {
        log.debug(
          'quote failed: rate enforcement may incur rounding errors. max packet amount of %s is below %s',
          maxSourcePacketAmount,
          minSourcePacketAmount
        )
        return PaymentError.ExchangeRateRoundingError
      }
    }

    let maxSourceAmount: PositiveInt
    let minDeliveryAmount: Int

    if (targetType === PaymentType.FixedSend) {
      maxSourceAmount = targetAmount
      minDeliveryAmount = targetAmount.subtract(sourceRoundingError).multiplyCeil(minExchangeRate)
    } else if (!minExchangeRate.isPositive()) {
      log.debug('quote failed: unenforceable payment delivery. min exchange rate is 0')
      return PaymentError.UnenforceableDelivery
    } else {
      // Why is the conversion floored? Consider if every part of target amount is delivered
      // at greater than or equal to the minimum exchange rate. Now: try to compute the corresponding
      // amount that was sent. After converting back, even if the source amount is not an even integer,
      // it is always the floor of that value, ... TODO

      // Why is the conversion here floored?
      // Assume `targetAmount` is always delivered at greater than or equal to the minimum
      // exchange rate. Thus, after inversing the rate to determine the source amount,
      // even if they are in between two integers, it's impossible for greater than that
      // source amount to have been the original, because ...

      // The final packet may be less than the minimum source packet amount, but if the minimum rate is enforced,
      // it would fail due to rounding. To account for this, increase max source amount by the allowed rounding error, 1 unit.

      // TODO Nice! This is a similar computation from the rate calculator computing the high-end source amount !
      maxSourceAmount = targetAmount
        .multiplyFloor(minExchangeRate.reciprocal())
        .add(sourceRoundingError)
      minDeliveryAmount = targetAmount
    }

    return {
      type: targetType,
      minDeliveryAmount,
      maxSourceAmount,
      minExchangeRate,
      rateCalculator,
      sourceRoundingError,
    }
  }

  nextState({ request, send, lookup }: SenderContext<Receipt>): SendState<Receipt> {
    const { maxSourceAmount, minDeliveryAmount, minExchangeRate, rateCalculator } = this.target
    const { log } = request

    // Ensure we never overpay the maximum source amount
    const availableToSend = maxSourceAmount
      .subtract(this.amountSent)
      .subtract(this.sourceAmountInFlight)
    if (!availableToSend.isPositive()) {
      // If we've sent as much as we can, next attempt will only be scheduled after an in-flight request finishes
      return RequestState.Yield()
    }

    // Compute source amount (always positive)
    const maxPacketAmount = lookup(MaxPacketAmountController).getNextMaxPacketAmount()
    let sourceAmount = availableToSend.orLesser(maxPacketAmount).orLesser(Int.MAX_U64)

    // Apply fixed delivery limits
    if (this.target.type === PaymentType.FixedDelivery) {
      const availableToDeliver = minDeliveryAmount
        .subtract(this.amountDelivered)
        .subtract(this.destinationAmountInFlight)
      if (!availableToDeliver.isPositive()) {
        // If we've sent as much as we can, next attempt will only be scheduled after an in-flight request finishes
        return RequestState.Yield()
      }

      const sourceAmountDeliveryLimit = rateCalculator.estimateSourceAmount(availableToDeliver)?.[1]
      if (!sourceAmountDeliveryLimit) {
        log.warn('payment cannot complete: exchange rate dropped to 0')
        return RequestState.Error(PaymentError.InsufficientExchangeRate)
      }

      sourceAmount = sourceAmount.orLesser(sourceAmountDeliveryLimit)
    }

    // Enforce the minimum exchange rate, and estimate how much will be received
    let minDestinationAmount = sourceAmount.multiplyCeil(minExchangeRate)
    const [
      projectedDestinationAmount,
      highEndDestinationAmount,
    ] = rateCalculator.estimateDestinationAmount(sourceAmount)

    // Check if the projected destination amount won't meet the minimum,
    // and if so, check if a delivery shortfall is allowed.
    const deliveryDeficit = minDestinationAmount.subtract(projectedDestinationAmount)
    if (deliveryDeficit.isPositive()) {
      // Is it probable that this packet will complete the payment?
      const completesPayment =
        this.target.type === PaymentType.FixedSend
          ? sourceAmount.isEqualTo(availableToSend)
          : this.amountDelivered
              .add(this.destinationAmountInFlight)
              .add(projectedDestinationAmount)
              .isGreaterThanOrEqualTo(minDeliveryAmount)

      // Only allow a destination shortfall within the allowed margin *on the final packet*.
      // If the packet doesn't complete the payment, the rate dropped and payment cannot be completed.
      if (this.availableDeliveryShortfall.isLessThan(deliveryDeficit) || !completesPayment) {
        log.warn('payment cannot complete: exchange rate dropped below minimum')
        return RequestState.Error(PaymentError.InsufficientExchangeRate)
      }

      minDestinationAmount = projectedDestinationAmount
    }

    // Risk of `minDestinationAmount` overflowing U64 range?
    // -----------------------------------------------------
    // Even if `minDestinationAmount` is initially calculated to be greater than MAX_U64
    // (e.g. suppose the probed rate is very large), it won't overflow:
    // The rate calculator caps projected destination amounts to MAX_U64.
    // If the `minDestinationAmount` is greater than the projected amounts,
    // the delivery deficit logic will enforce and reduce it, or will
    // fail the payment due to an exchange rate error.

    // Update in-flight amounts (request will be queued & applied synchronously)
    this.sourceAmountInFlight = this.sourceAmountInFlight.add(sourceAmount)
    this.destinationAmountInFlight = this.destinationAmountInFlight.add(highEndDestinationAmount)
    this.availableDeliveryShortfall = this.availableDeliveryShortfall.subtract(deliveryDeficit)

    request
      .setSourceAmount(sourceAmount)
      .setMinDestinationAmount(minDestinationAmount)
      .enableFulfillment()
      .addFrames(new StreamMoneyFrame(PaymentController.DEFAULT_STREAM_ID, 1))

    this.progressHandler?.(this.getReceipt())

    send(
      (reply): SendState<Receipt> => {
        // Delivered amount must be *at least* the minimum acceptable amount we told the receiver
        // No matter what, since they fulfilled it, we must assume they got at least the minimum
        const destinationAmount = minDestinationAmount.orGreater(reply.destinationAmount)

        if (reply.isFulfill()) {
          this.amountSent = this.amountSent.add(sourceAmount)
          this.amountDelivered = this.amountDelivered.add(destinationAmount)

          log.debug(
            'accounted for fulfill. sent=%s delivered=%s minDestination=%s',
            sourceAmount,
            destinationAmount,
            minDestinationAmount
          )
        }

        if (reply.isReject() && reply.destinationAmount?.isLessThan(minDestinationAmount)) {
          log.debug(
            'packet rejected for insufficient rate. received=%s minDestination=%s',
            reply.destinationAmount,
            minDestinationAmount
          )
        }

        // Update in-flight amounts
        this.sourceAmountInFlight = this.sourceAmountInFlight.subtract(sourceAmount)
        this.destinationAmountInFlight = this.destinationAmountInFlight.subtract(
          highEndDestinationAmount
        )
        // If this packet failed (e.g. for some other reason), refund the delivery deficit so it may be retried
        if (reply.isReject()) {
          this.availableDeliveryShortfall = this.availableDeliveryShortfall.add(deliveryDeficit)
        }

        log.debug(
          'payment sent %s of %s (max). inflight=%s',
          this.amountSent,
          this.target.maxSourceAmount,
          this.sourceAmountInFlight
        )
        log.debug(
          'payment delivered %s of %s (min). inflight=%s (destination units)',
          this.amountDelivered,
          this.target.minDeliveryAmount,
          this.destinationAmountInFlight
        )

        this.updateStreamReceipt(reply)

        this.progressHandler?.(this.getReceipt())

        // Handle protocol violations after all accounting has been performed
        if (reply.isFulfill()) {
          if (!reply.destinationAmount) {
            // Technically, an intermediary could strip the data so we can't ascertain whose fault this is
            log.warn('ending payment: packet fulfilled with no authentic STREAM data')
            return SendState.Error(PaymentError.ReceiverProtocolViolation)
          } else if (reply.destinationAmount.isLessThan(minDestinationAmount)) {
            log.warn(
              'ending payment: receiver violated procotol. packet fulfilled below min exchange rate. delivered=%s minDestination=%s',
              destinationAmount,
              minDestinationAmount
            )
            return SendState.Error(PaymentError.ReceiverProtocolViolation)
          }
        }

        if (!this.sourceAmountInFlight.isPositive()) {
          const paidFixedSend =
            this.target.type === PaymentType.FixedSend && this.amountSent.isEqualTo(maxSourceAmount)
          if (paidFixedSend) {
            log.debug('payment complete: paid fixed source amount.')
            return SendState.Done(this.getReceipt())
          }

          const paidFixedDelivery =
            this.target.type === PaymentType.FixedDelivery &&
            this.amountDelivered.isGreaterThanOrEqualTo(minDeliveryAmount)
          if (paidFixedDelivery) {
            log.debug('payment complete: paid fixed destination amount.')
            return SendState.Done(this.getReceipt())
          }
        }

        this.remoteReceiveMax =
          this.updateReceiveMax(reply)?.orGreater(this.remoteReceiveMax) ?? this.remoteReceiveMax
        if (this.remoteReceiveMax?.isLessThan(this.target.minDeliveryAmount)) {
          log.error(
            'ending payment: minimum delivery amount is too much for recipient. minDelivery=%s receiveMax=%s',
            this.target.minDeliveryAmount,
            this.remoteReceiveMax
          )
          return SendState.Error(PaymentError.IncompatibleReceiveMax)
        }

        // Since payment isn't complete yet, immediately queue attempt to send more money
        // (in case we were at max in flight previously)
        return SendState.Schedule()
      }
    )

    // Immediately schedule another request to be attempted
    return RequestState.Schedule()
  }

  getReceipt(): Receipt {
    return {
      streamReceipt: this.latestReceipt?.buffer,
      amountSent: this.amountSent,
      amountDelivered: this.amountDelivered,
      sourceAmountInFlight: this.sourceAmountInFlight,
      destinationAmountInFlight: this.destinationAmountInFlight,
    }
  }

  private updateReceiveMax({ frames }: StreamReply): Int | undefined {
    return frames
      ?.filter((frame): frame is StreamMaxMoneyFrame => frame.type === FrameType.StreamMaxMoney)
      .filter((frame) => frame.streamId.equals(PaymentController.DEFAULT_STREAM_ID))
      .map((frame) => Int.from(frame.receiveMax))?.[0]
  }

  private updateStreamReceipt({ log, frames }: StreamReply): void {
    // Check for receipt frame
    // No need to check streamId, since we only send over stream=1
    const receiptBuffer = frames?.find(
      (frame): frame is StreamReceiptFrame => frame.type === FrameType.StreamReceipt
    )?.receipt
    if (!receiptBuffer) {
      return
    }

    // Decode receipt, discard if invalid
    let receipt: StreamReceipt
    try {
      receipt = decodeReceipt(receiptBuffer)
    } catch (_) {
      return
    }

    const newTotalReceived = Int.from(receipt.totalReceived)
    if (!this.latestReceipt || newTotalReceived.isGreaterThan(this.latestReceipt.totalReceived)) {
      log.debug('updated latest stream receipt for %s', newTotalReceived)
      this.latestReceipt = {
        totalReceived: newTotalReceived,
        buffer: receiptBuffer,
      }
    }
  }
}
