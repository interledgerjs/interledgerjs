import { RequestState, StreamSender, SendState, GetController } from '.'
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
import { RequestBuilder, StreamReply } from '../request'
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
}

/** Controller to track the payment status and compute amounts to send and deliver */
export class PaymentController implements StreamSender<undefined> {
  static DEFAULT_STREAM_ID = 1

  /** Total amount sent and fulfilled, in scaled units of the sending account */
  private amountSent = Int.ZERO

  /** Total amount delivered and fulfilled, in scaled units of the receiving account */
  private amountDelivered = Int.ZERO

  /** Amount sent that is yet to be fulfilled or rejected, in scaled units of the sending account */
  private sourceAmountInFlight = Int.ZERO

  /** Estimate of the amount that may be delivered from in-flight packets, in scaled units of the receiving account */
  private destinationAmountInFlight = Int.ZERO

  /** Was the rounding error shortfall applied to an in-flight or delivered packet? */
  private appliedRoundingCorrection = false

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
  ) {}

  static createPaymentTarget(
    targetAmount: PositiveInt,
    targetType: PaymentType,
    minExchangeRate: Ratio,
    rateCalculator: ExchangeRateCalculator,
    log: Logger
  ): PaymentTarget | PaymentError {
    const [lowerBoundRate] = rateCalculator.getRate()
    if (!lowerBoundRate.isPositive()) {
      log.debug('quote failed: probed exchange rate is 0')
      return PaymentError.InsufficientExchangeRate
    }

    // Per rate probe, the source amount of the lowerBoundRate is already the maxPacketAmount.
    // So, no rounding error is possible as long as minRate is at least the probed rate.
    // ceil(maxPacketAmount * minExchangeRate) >= floor(maxPacketAmount * lowerBoundRate)
    // ceil(maxPacketAmount * minExchangeRate) >= lowerBoundRate.delivered
    if (!lowerBoundRate.isGreaterThanOrEqualTo(minExchangeRate)) {
      log.debug(
        'quote failed: probed exchange rate of %s does not exceed minimum of %s',
        lowerBoundRate,
        minExchangeRate
      )
      return PaymentError.InsufficientExchangeRate
    }

    // At each hop, up to 1 unit of the local asset before the conversion
    // is "lost" to rounding when the outgoing amount is floored.
    // If a small packet is sent, such as the final one in the payment,
    // it may not meet its minimum destination amount since the rounding
    // error caused a shortfall.

    // To address this, allow up to 1 source unit to *not* be delivered.
    // This is accounted for and allowed within the quoted maximum source amount.

    let maxSourceAmount: PositiveInt
    let minDeliveryAmount: Int

    if (targetType === PaymentType.FixedSend) {
      maxSourceAmount = targetAmount
      minDeliveryAmount = targetAmount.saturatingSubtract(Int.ONE).multiplyCeil(minExchangeRate)
    } else if (!minExchangeRate.isPositive()) {
      log.debug('quote failed: unenforceable payment delivery. min exchange rate is 0')
      return PaymentError.UnenforceableDelivery
    } else {
      // - Consider that we're trying to discover the maximum original integer value that
      //   delivered the target delivery amount. If it converts back into a decimal
      //   source amount, it's safe to floor, since we assume each portion of the target
      //   delivery amount was already ceil-ed and delivered at greater than the minimum rate.
      // - Then, add one to account for the source unit allowed lost to a rounding error.
      maxSourceAmount = targetAmount.multiplyFloor(minExchangeRate.reciprocal()).add(Int.ONE)
      minDeliveryAmount = targetAmount
    }

    return {
      type: targetType,
      minDeliveryAmount,
      maxSourceAmount,
      minExchangeRate,
      rateCalculator,
    }
  }

  nextState(request: RequestBuilder, lookup: GetController): SendState<undefined> {
    const { maxSourceAmount, minDeliveryAmount, minExchangeRate, rateCalculator } = this.target
    const { log } = request

    // Ensure we never overpay the maximum source amount
    const availableToSend = maxSourceAmount
      .saturatingSubtract(this.amountSent)
      .saturatingSubtract(this.sourceAmountInFlight)
    if (!availableToSend.isPositive()) {
      // If we've sent as much as we can, next attempt will only be scheduled after an in-flight request finishes
      return SendState.Yield()
    }

    // Compute source amount (always positive)
    const maxPacketAmount = lookup(MaxPacketAmountController).getNextMaxPacketAmount()
    let sourceAmount = availableToSend.orLesser(maxPacketAmount).orLesser(Int.MAX_U64)

    // Does this request complete the payment, so should the rounding correction be applied?
    let completesPayment = false

    // Apply fixed delivery limits
    if (this.target.type === PaymentType.FixedDelivery) {
      const remainingToDeliver = minDeliveryAmount
        .saturatingSubtract(this.amountDelivered)
        .saturatingSubtract(this.destinationAmountInFlight)
      if (!remainingToDeliver.isPositive()) {
        // If we've already sent enough to potentially complete the payment,
        // next attempt will only be scheduled after an in-flight request finishes
        return SendState.Yield()
      }

      const sourceAmountDeliveryLimit = rateCalculator.estimateSourceAmount(remainingToDeliver)?.[1]
      if (!sourceAmountDeliveryLimit) {
        log.warn('payment cannot complete: exchange rate dropped to 0')
        return SendState.Error(PaymentError.InsufficientExchangeRate)
      }

      sourceAmount = sourceAmount.orLesser(sourceAmountDeliveryLimit)
      completesPayment = sourceAmount.isEqualTo(sourceAmountDeliveryLimit)
    } else {
      completesPayment = sourceAmount.isEqualTo(availableToSend)
    }

    // Enforce the minimum exchange rate.
    // Allow up to 1 source unit to be lost to rounding only *on the final packet*.
    const applyCorrection = completesPayment && !this.appliedRoundingCorrection
    const minDestinationAmount = applyCorrection
      ? sourceAmount.saturatingSubtract(Int.ONE).multiplyCeil(minExchangeRate)
      : sourceAmount.multiplyCeil(minExchangeRate)

    // If the min destination amount isn't met, the rate dropped and payment cannot be completed.
    const [
      projectedDestinationAmount,
      highEndDestinationAmount,
    ] = rateCalculator.estimateDestinationAmount(sourceAmount)
    if (projectedDestinationAmount.isLessThan(minDestinationAmount)) {
      log.warn('payment cannot complete: exchange rate dropped below minimum')
      return RequestState.Error(PaymentError.InsufficientExchangeRate)
    }

    // Rate calculator caps projected destination amounts to U64,
    // so that checks against `minDestinationAmount` overflowing U64 range

    // Update in-flight amounts (request will be applied synchronously)
    this.sourceAmountInFlight = this.sourceAmountInFlight.add(sourceAmount)
    this.destinationAmountInFlight = this.destinationAmountInFlight.add(highEndDestinationAmount)
    this.appliedRoundingCorrection = applyCorrection

    this.progressHandler?.(this.getReceipt())

    request
      .setSourceAmount(sourceAmount)
      .setMinDestinationAmount(minDestinationAmount)
      .enableFulfillment()
      .addFrames(new StreamMoneyFrame(PaymentController.DEFAULT_STREAM_ID, 1))

    return SendState.Send((reply) => {
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
      this.sourceAmountInFlight = this.sourceAmountInFlight.saturatingSubtract(sourceAmount)
      this.destinationAmountInFlight = this.destinationAmountInFlight.saturatingSubtract(
        highEndDestinationAmount
      )
      // If this packet failed (e.g. for some other reason), refund the delivery deficit so it may be retried
      if (reply.isReject() && applyCorrection) {
        this.appliedRoundingCorrection = false
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

      const paidFixedSend =
        this.target.type === PaymentType.FixedSend && this.amountSent.isEqualTo(maxSourceAmount) // Amount in flight is always 0 if this is true
      if (paidFixedSend) {
        log.debug('payment complete: paid fixed source amount.')
        return SendState.Done(undefined)
      }

      const paidFixedDelivery =
        this.target.type === PaymentType.FixedDelivery &&
        this.amountDelivered.isGreaterThanOrEqualTo(minDeliveryAmount) &&
        !this.sourceAmountInFlight.isPositive()
      if (paidFixedDelivery) {
        log.debug('payment complete: paid fixed destination amount.')
        return SendState.Done(undefined)
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
    })
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
