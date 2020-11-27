import { SendLoop, ControllerSet } from '.'
import { Ratio, Int, PositiveInt } from '../utils'
import {
  StreamMaxMoneyFrame,
  FrameType,
  StreamMoneyFrame,
} from 'ilp-protocol-stream/dist/src/packet'
import { MaxPacketAmountController } from './max-packet'
import { ExchangeRateCalculator, ExchangeRateController } from './exchange-rate'
import { PaymentError, Receipt } from '..'
import { Logger } from 'ilp-logger'
import { StreamReply, RequestBuilder, StreamRequest } from '../request'
import { ReceiptController } from './receipt'
import { InFlightTracker } from './pending-requests'
import { PacingController } from './pacer'
import { AssetDetailsController } from './asset-details'
import { TimeoutController } from './timeout'
import { FailureController } from './failure'
import { ExpiryController } from './expiry'
import { EstablishmentController } from './establishment'
import { SequenceController } from './sequence'
import { StreamConnection } from '../connection'

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
  sourceRoundingError: PositiveInt
}

/** Controller to track the payment status and compute amounts to send and deliver */
export class PaymentController extends SendLoop<Receipt> {
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

  constructor(
    connection: StreamConnection,
    controllers: ControllerSet,

    /** Conditions that must be met for the payment to complete, and parameters of its execution */
    private readonly target: PaymentTarget,

    /** Callback to pass updates as packets are sent and received */
    private readonly progressHandler?: (status: Receipt) => void
  ) {
    super(connection, controllers)

    // TODO Change this
    // Tolerate up to 1 source unit, converted into destination units, to be lost, below the enforced
    // minimum destination amounts. This enables reliable delivery of the final payment packet.
    this.availableDeliveryShortfall = target.sourceRoundingError.multiplyCeil(
      target.minExchangeRate
    ) // TODO Is this floor or ceil?
  }

  // TODO Add explanation for this ordering
  order = [
    SequenceController,
    EstablishmentController,
    ExpiryController,
    FailureController,
    TimeoutController,
    MaxPacketAmountController,
    AssetDetailsController,
    PacingController,
    ReceiptController,
    ExchangeRateController,
    InFlightTracker,
  ]

  static createPaymentTarget(
    targetAmount: PositiveInt,
    targetType: PaymentType,
    minExchangeRate: Ratio,
    rateCalculator: ExchangeRateCalculator,
    maxSourcePacketAmount: Int,
    log: Logger
  ): PaymentTarget | PaymentError {
    const { lowerBoundRate, upperBoundRate } = rateCalculator

    if (!lowerBoundRate.isPositive() || !upperBoundRate.isPositive()) {
      log.debug('quote failed: probed exchange rate is 0')
      return PaymentError.InsufficientExchangeRate
    }

    const marginOfError = lowerBoundRate.subtract(minExchangeRate)
    if (!marginOfError.isPositive()) {
      log.debug(
        'quote failed: probed exchange rate of %s is below minimum of %s',
        lowerBoundRate,
        minExchangeRate
      )
      return PaymentError.InsufficientExchangeRate
    }

    // Assuming we accurately know the real exchange rate, if the actual destination amount is less than the
    // min destination amount set by the sender, the packet fails due to a rounding error, since intermediaries round down, but senders round up:
    // - realDestinationAmount = floor(sourceAmount * realExchangeRate) <--- Determined by intermediaries
    // - minDestinationAmount  =  ceil(sourceAmount * minExchangeRate)  <--- Determined by sender

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

    // If a packet is sent with too low of an amount, the amount lost to rounding,
    // at each hop, is 1 unit of the local asset before the conversion.
    // prettier-ignore
    const sourceRoundingError =
      Int.ONE // Tolerate one packet rounding error from source unit to next hop
        .add(
          // Tolerate one packet rounding error for 2 intermediary hops.
          // Assume remote max packet size is no less than 10,000 foreign units,
          // to estimate the number of source units equal to a foreign unit.
          maxSourcePacketAmount.divideCeil(Int.from(10_000) as PositiveInt).multiply(Int.TWO)
        )
    // TODO What if max packet amount is huge, e.g. max u64? How should this be capped?

    // TODO Alternatively... maybe it could be, e.g., "up to 100x the valueof one source unit--in the foreign unit--can be lost to rounding"

    // const deliveryShortfall = sourceAmountError.multiplyCeil(minExchangeRate)

    let maxSourceAmount: PositiveInt
    let minDeliveryAmount: Int

    if (targetType === PaymentType.FixedSend) {
      maxSourceAmount = targetAmount
      minDeliveryAmount = targetAmount.subtract(sourceRoundingError).multiplyCeil(minExchangeRate)
    } else {
      if (!minExchangeRate.isPositive()) {
        log.debug('quote failed: unenforceable payment delivery. min exchange rate is 0')
        return PaymentError.UnenforceableDelivery
      }

      // The final packet may be less than the minimum source packet amount, but if the minimum rate is enforced,
      // it would fail due to rounding. To account for this, increase max source amount by 1 unit.
      maxSourceAmount = targetAmount
        .multiplyCeil(minExchangeRate.reciprocal())
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

  protected async trySending(request: StreamRequest): Promise<Receipt | PaymentError> {
    const pendingRequests = this.controllers.get(InFlightTracker).getPendingRequests()

    const { maxSourceAmount, minDeliveryAmount, minExchangeRate, rateCalculator } = this.target
    const { log } = request

    const paidFixedSend =
      this.target.type === PaymentType.FixedSend &&
      this.amountSent.isEqualTo(maxSourceAmount) &&
      !this.sourceAmountInFlight.isPositive()
    if (paidFixedSend) {
      log.debug('payment complete: paid fixed source amount.')
      return this.buildReceipt()
    }

    // Ensure we never overpay the maximum source amount
    const availableToSend = maxSourceAmount
      .subtract(this.amountSent)
      .subtract(this.sourceAmountInFlight)
    if (!availableToSend.isPositive()) {
      // If we've sent as much as we can, schedule next attempt after any in-flight request finishes
      return this.run(Promise.race(pendingRequests))
    }

    // Compute source amount (always positive)
    const maxPacketAmount = this.controllers.get(MaxPacketAmountController).getNextMaxPacketAmount()
    let sourceAmount = availableToSend.orLesser(maxPacketAmount).orLesser(Int.MAX_U64)

    // Apply fixed delivery limits
    if (this.target.type === PaymentType.FixedDelivery) {
      const remainingToDeliver = minDeliveryAmount.subtract(this.amountDelivered)
      const paidFixedDelivery =
        remainingToDeliver.isEqualTo(Int.ZERO) && !this.sourceAmountInFlight.isPositive()
      if (paidFixedDelivery) {
        log.debug('payment complete: paid fixed destination amount.')
        return this.buildReceipt()
      }

      const availableToDeliver = remainingToDeliver.subtract(this.destinationAmountInFlight)
      if (!availableToDeliver.isPositive()) {
        // If we've sent as much as we can, schedule next attempt after any in-flight request finishes
        return this.run(Promise.race(pendingRequests))
      }

      const sourceAmountDeliveryLimit = rateCalculator.estimateSourceAmount(availableToDeliver)?.[1]
      if (!sourceAmountDeliveryLimit) {
        log.warn('payment cannot complete: exchange rate dropped to 0')
        return PaymentError.InsufficientExchangeRate
      }

      sourceAmount = sourceAmount.orLesser(sourceAmountDeliveryLimit)
    }

    // Enforce the minimum exchange rate, and estimate how much will be received
    let minDestinationAmount = sourceAmount.multiplyCeil(minExchangeRate)
    const [
      projectedDestinationAmount,
      highEndDestinationAmount,
    ] = rateCalculator.estimateDestinationAmount(sourceAmount)

    // Only allow a destination shortfall within the allowed margins *on the final packet*.
    // If the packet is insufficient to complete the payment, the rate dropped and cannot be completed.
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

      if (this.availableDeliveryShortfall.isLessThan(deliveryDeficit) || !completesPayment) {
        log.warn('payment cannot complete: exchange rate dropped below minimum')
        return PaymentError.InsufficientExchangeRate
      }

      minDestinationAmount = projectedDestinationAmount
    }

    // Update in-flight amounts (request will be queued & applied synchronously)
    this.sourceAmountInFlight = this.sourceAmountInFlight.add(sourceAmount)
    this.destinationAmountInFlight = this.destinationAmountInFlight.add(highEndDestinationAmount)
    this.availableDeliveryShortfall = this.availableDeliveryShortfall.subtract(deliveryDeficit)
    this.emitProgressEvent()

    request = new RequestBuilder(request)
      .setSourceAmount(sourceAmount)
      .setMinDestinationAmount(minDestinationAmount)
      .enableFulfillment()
      .addFrames(new StreamMoneyFrame(PaymentController.DEFAULT_STREAM_ID, 1))
      .build()

    this.send(request).then((reply) => {
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
          destinationAmount,
          minDestinationAmount
        )
      }

      // Update in-flight amounts
      this.sourceAmountInFlight = this.sourceAmountInFlight.subtract(sourceAmount)
      this.destinationAmountInFlight = this.destinationAmountInFlight.subtract(
        highEndDestinationAmount
      )
      // If this packet failed, "refund" the delivery deficit so it may be retried
      if (reply.isReject()) {
        this.availableDeliveryShortfall = this.availableDeliveryShortfall.add(deliveryDeficit)
      }

      if (this.target.type === PaymentType.FixedSend) {
        log.debug(
          'payment sent %s of %s. inflight=%s',
          this.amountSent,
          this.target.maxSourceAmount,
          this.sourceAmountInFlight
        )
      } else {
        log.debug(
          'payment delivered %s of %s. inflight=%s (destination units)',
          this.amountDelivered,
          this.target.minDeliveryAmount,
          this.destinationAmountInFlight
        )
      }

      this.emitProgressEvent()

      // Handle protocol violations after all accounting has been performed
      if (reply.isFulfill()) {
        if (!reply.destinationAmount) {
          // Technically, an intermediary could strip the data so we can't ascertain whose fault this is
          log.warn('ending payment: packet fulfilled with no authentic STREAM data')
          return PaymentError.ReceiverProtocolViolation
        } else if (reply.destinationAmount.isLessThan(minDestinationAmount)) {
          log.warn(
            'ending payment: receiver violated procotol. packet fulfilled below min exchange rate. delivered=%s minDestination=%s',
            destinationAmount,
            minDestinationAmount
          )
          return PaymentError.ReceiverProtocolViolation
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
        return PaymentError.IncompatibleReceiveMax
      }
    })

    // Immediately schedule another request to be sent
    return this.run()
  }

  private updateReceiveMax({ frames }: StreamReply): Int | undefined {
    return frames
      ?.filter((frame): frame is StreamMaxMoneyFrame => frame.type === FrameType.StreamMaxMoney)
      .filter((frame) => frame.streamId.equals(PaymentController.DEFAULT_STREAM_ID))
      .map((frame) => Int.from(frame.receiveMax))?.[0]
  }

  private emitProgressEvent(): void {
    this.progressHandler?.(this.buildReceipt())
  }

  private buildReceipt(): Receipt {
    return {
      streamReceipt: this.controllers.get(ReceiptController).getReceipt(),
      amountSent: this.amountSent,
      amountDelivered: this.amountDelivered,
      sourceAmountInFlight: this.sourceAmountInFlight,
      destinationAmountInFlight: this.destinationAmountInFlight,
    }
  }
}
