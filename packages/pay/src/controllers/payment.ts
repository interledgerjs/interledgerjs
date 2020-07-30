import { ControllerMap, StreamController, StreamRequest, StreamReply, NextRequest } from '.'
import { Ratio, Int, PositiveInt, PromiseResolver } from '../utils'
import {
  StreamMaxMoneyFrame,
  FrameType,
  StreamMoneyFrame,
  ErrorCode,
} from 'ilp-protocol-stream/dist/src/packet'
import { MaxPacketAmountController } from './max-packet'
import { ExchangeRateCalculator } from './exchange-rate'
import { PaymentError } from '..'
import { Logger } from 'ilp-logger'

export const DEFAULT_STREAM_ID = 1

export interface EstimatedPaymentOutcome {
  estimatedNumberOfPackets: PositiveInt
  maxSourceAmount: PositiveInt
  minDeliveryAmount: Int
}

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
export class PaymentController implements StreamController {
  /** Conditions that must be met for the payment to complete, and parameters of its execution */
  private target?: PaymentTarget

  /** Total amount sent and fulfilled, in scaled units of the sending account */
  private amountSent = Int.ZERO

  /** Total amount delivered and fulfilled, in scaled units of the receiving account */
  private amountDelivered = Int.ZERO

  /** Amount sent that is yet to be fulfilled or rejected, in scaled units of the sending account */
  private sourceAmountInFlight = Int.ZERO

  /** Estimate of the amount that may be delivered from in-flight packets, in scaled units of the receiving account */
  private destinationAmountInFlight = Int.ZERO

  /** Amount in destination units allowed to be lost to rounding, below the enforced exchange rate */
  private availableDeliveryShortfall = Int.ZERO

  /** Maximum amount the recipient can receive on the default stream */
  private remoteReceiveMax?: Int

  /** Should the connection be closed because the receiver violated the STREAM protocol? */
  private encounteredProtocolViolation = false

  /** Promise that resolves when the target is complete */
  private paymentStatus = new PromiseResolver<void>()

  setPaymentTarget(
    targetAmount: PositiveInt,
    targetType: PaymentType,
    minExchangeRate: Ratio,
    rateCalculator: ExchangeRateCalculator,
    maxSourcePacketAmount: Int,
    log: Logger
  ): EstimatedPaymentOutcome | PaymentError {
    const { lowerBoundRate, upperBoundRate } = rateCalculator

    if (!lowerBoundRate.isPositive() || !upperBoundRate.isPositive()) {
      log.debug('quote failed: probed exchange rate is 0')
      return PaymentError.InsufficientExchangeRate
    }

    const marginOfError = lowerBoundRate.subtract(minExchangeRate)
    if (!marginOfError.isPositive()) {
      log.debug(
        'quote failed: probed exchange rate of %s is not greater than minimum of %s',
        lowerBoundRate,
        minExchangeRate
      )
      return PaymentError.InsufficientExchangeRate
    }

    // Assuming we accurately know the real exchange rate, if the actual destination amount is less than the
    // min destination amount set by the sender, the packet fails due to a rounding error,
    // since intermediaries round down, but senders round up:
    // - realDestinationAmount = floor(sourceAmount * realExchangeRate) --- Determined by intermediaries
    // - minDestinationAmount  =  ceil(sourceAmount * minExchangeRate)  --- Determined by sender

    // Packets that aren't at least this minimum source amount *may* fail due to rounding.
    // If the max packet amount is insufficient, fail fast, since the payment is unlikely to succeed.
    const minSourcePacketAmount = Int.ONE.multiplyCeil(marginOfError.reciprocal())
    if (!maxSourcePacketAmount.isGreaterThanOrEqualTo(minSourcePacketAmount)) {
      log.debug(
        'quote failed: rate enforcement may incur rounding errors. max packet amount of %s is below proposed minimum of %s',
        maxSourcePacketAmount,
        minSourcePacketAmount
      )
      return PaymentError.ExchangeRateRoundingError
    }

    // To prevent the final packet from failing due to rounding, account for a small
    // "shortfall" of 1 source unit, converted to destination units,
    // to tolerate below the enforced destination amounts from the minimum exchange rate.
    this.availableDeliveryShortfall = Int.ONE.multiplyCeil(minExchangeRate)

    if (targetType === PaymentType.FixedSend) {
      const estimatedNumberOfPackets = targetAmount.divideCeil(maxSourcePacketAmount)
      const maxSourceAmount = targetAmount
      const minDeliveryAmount = targetAmount.subtract(Int.ONE).multiplyCeil(minExchangeRate)

      this.target = {
        type: PaymentType.FixedSend,
        maxSourceAmount,
        minDeliveryAmount,
        minExchangeRate,
        rateCalculator,
      }

      return {
        maxSourceAmount,
        minDeliveryAmount,
        estimatedNumberOfPackets,
      }
    } else {
      if (!minExchangeRate.isPositive()) {
        log.debug('quote failed: unenforceable payment delivery. min exchange rate is 0')
        return PaymentError.UnenforceableDelivery
      }

      // The final packet may be less than the minimum source packet amount, but if the minimum rate is enforced,
      // it would fail due to rounding. To account for this, increase max source amount by 1 unit.
      const maxSourceAmount = targetAmount.multiplyCeil(minExchangeRate.reciprocal()).add(Int.ONE)
      const minDeliveryAmount = targetAmount
      const estimatedNumberOfPackets = maxSourceAmount.divideCeil(maxSourcePacketAmount)

      this.target = {
        type: PaymentType.FixedDelivery,
        minDeliveryAmount,
        maxSourceAmount,
        minExchangeRate,
        rateCalculator,
      }

      return {
        maxSourceAmount,
        minDeliveryAmount,
        estimatedNumberOfPackets,
      }
    }
  }

  nextState(request: NextRequest, controllers: ControllerMap): PaymentError | void {
    if (this.encounteredProtocolViolation) {
      request.addConnectionClose(ErrorCode.ProtocolViolation).send()
      return PaymentError.ReceiverProtocolViolation
    }

    // No fixed source or delivery amount set
    if (!this.target) {
      return
    }

    const { maxSourceAmount, minDeliveryAmount, minExchangeRate, rateCalculator } = this.target
    const { log } = request

    // Is the recipient's advertised `receiveMax` less than the fixed destination amount?
    const incompatibleReceiveMax =
      this.remoteReceiveMax && minDeliveryAmount.isGreaterThan(this.remoteReceiveMax)
    if (incompatibleReceiveMax) {
      log.error(
        'ending payment: minimum delivery amount is too much for recipient. minimum delivery amount: %s, receive max: %s',
        minDeliveryAmount,
        this.remoteReceiveMax
      )
      request.addConnectionClose(ErrorCode.ApplicationError).send()
      return PaymentError.IncompatibleReceiveMax
    }

    if (this.target.type === PaymentType.FixedSend) {
      const paidFixedSend =
        this.amountSent.isEqualTo(maxSourceAmount) && !this.sourceAmountInFlight.isPositive()
      if (paidFixedSend) {
        log.debug('payment complete: paid fixed source amount. sent %s', this.amountSent)
        this.paymentStatus.resolve()
        return request.addConnectionClose().send()
      }
    }

    // Ensure we never overpay the maximum source amount
    const availableToSend = maxSourceAmount
      .subtract(this.amountSent)
      .subtract(this.sourceAmountInFlight)
    if (!availableToSend.isPositive()) {
      return
    }

    // Compute source amount (always positive)
    const maxPacketAmount = controllers.get(MaxPacketAmountController).getNextMaxPacketAmount()
    let sourceAmount: PositiveInt = availableToSend
      .orLesser(maxPacketAmount ?? Int.MAX_U64)
      .orLesser(Int.MAX_U64)

    // Check if fixed delivery payment is complete, and apply limits
    if (this.target.type === PaymentType.FixedDelivery) {
      const remainingToDeliver = minDeliveryAmount.subtract(this.amountDelivered)
      const paidFixedDelivery =
        remainingToDeliver.isLessThanOrEqualTo(Int.ZERO) && !this.sourceAmountInFlight.isPositive()
      if (paidFixedDelivery) {
        log.debug(
          'payment complete: paid fixed destination amount. delivered %s of %s',
          this.amountDelivered,
          minDeliveryAmount
        )
        this.paymentStatus.resolve()
        return request.addConnectionClose().send()
      }

      const availableToDeliver = remainingToDeliver.subtract(this.destinationAmountInFlight)
      if (!availableToDeliver.isPositive()) {
        return
      }

      const sourceAmountDeliveryLimit = rateCalculator.estimateSourceAmount(availableToDeliver)?.[1]
      if (!sourceAmountDeliveryLimit) {
        log.warn('payment cannot complete: exchange rate dropped to 0')
        request.addConnectionClose().send()
        return PaymentError.InsufficientExchangeRate
      }

      sourceAmount = sourceAmount.orLesser(sourceAmountDeliveryLimit)
    }

    // Enforce the minimum exchange rate, and estimate how much will be received
    let minDestinationAmount = sourceAmount.multiplyCeil(minExchangeRate)
    const estimatedDestinationAmount = rateCalculator.estimateDestinationAmount(sourceAmount)[0]

    // Only allow a destination shortfall within the allowed margins *on the final packet*.
    // If the packet is insufficient to complete the payment, the rate dropped and cannot be completed.
    const deliveryDeficit = minDestinationAmount.subtract(estimatedDestinationAmount)
    if (deliveryDeficit.isPositive()) {
      // Is it probable that this packet will complete the payment?
      const completesPayment =
        this.target.type === PaymentType.FixedSend
          ? sourceAmount.isEqualTo(availableToSend)
          : this.amountDelivered
              .add(this.destinationAmountInFlight)
              .add(estimatedDestinationAmount)
              .isGreaterThanOrEqualTo(minDeliveryAmount)

      if (this.availableDeliveryShortfall.isLessThan(deliveryDeficit) || !completesPayment) {
        log.warn('payment cannot complete: exchange rate dropped below minimum')
        request.addConnectionClose().send()
        return PaymentError.InsufficientExchangeRate
      }

      minDestinationAmount = estimatedDestinationAmount
    }

    request
      .setSourceAmount(sourceAmount)
      .setMinDestinationAmount(minDestinationAmount)
      .enableFulfillment()
      .addFrames(new StreamMoneyFrame(DEFAULT_STREAM_ID, 1))
      .send()
  }

  applyRequest(request: StreamRequest): (reply: StreamReply) => void {
    const { sourceAmount, minDestinationAmount, isFulfillable, log } = request

    let highEndDestinationAmount = Int.ZERO
    let deliveryDeficit = Int.ZERO

    if (this.target && isFulfillable) {
      // Estimate the most that this packet will deliver
      highEndDestinationAmount = minDestinationAmount.orGreater(
        this.target.rateCalculator.estimateDestinationAmount(sourceAmount)[1]
      )

      // Update in-flight amounts
      this.sourceAmountInFlight = this.sourceAmountInFlight.add(sourceAmount)
      this.destinationAmountInFlight = this.destinationAmountInFlight.add(highEndDestinationAmount)

      // Update the delivery shoftfall, if applicable
      const baselineMinDestinationAmount = sourceAmount.multiplyCeil(this.target.minExchangeRate)
      deliveryDeficit = baselineMinDestinationAmount.subtract(minDestinationAmount)
      if (deliveryDeficit.isPositive()) {
        this.availableDeliveryShortfall = this.availableDeliveryShortfall.subtract(deliveryDeficit)
      }
    }

    return (reply: StreamReply) => {
      let { destinationAmount } = reply

      if (reply.isFulfill()) {
        // Delivered amount must be *at least* the minimum acceptable amount we told the receiver
        // No matter what, since they fulfilled it, we must assume they got at least the minimum
        if (!destinationAmount) {
          // Technically, an intermediary could strip the data so we can't ascertain whose fault this is
          log.warn('ending payment: packet fulfilled with no authentic STREAM data')
          destinationAmount = minDestinationAmount
          this.encounteredProtocolViolation = true
        } else if (destinationAmount.isLessThan(minDestinationAmount)) {
          log.warn(
            'ending payment: receiver violated protocol. packet below minimum exchange rate was fulfilled. delivered: %s, min destination amount: %s',
            destinationAmount,
            minDestinationAmount
          )
          destinationAmount = minDestinationAmount
          this.encounteredProtocolViolation = true
        } else {
          log.trace(
            'packet sent: %s, packet delivered: %s, min destination amount: %s',
            sourceAmount,
            destinationAmount,
            minDestinationAmount
          )
        }

        this.amountSent = this.amountSent.add(sourceAmount)
        this.amountDelivered = this.amountDelivered.add(destinationAmount)
      } else if (destinationAmount?.isLessThan(minDestinationAmount)) {
        log.debug(
          'packet rejected for insufficient rate: min destination amount: %s, received amount: %s',
          minDestinationAmount,
          destinationAmount
        )
      }

      if (isFulfillable) {
        this.sourceAmountInFlight = this.sourceAmountInFlight.subtract(sourceAmount)
        this.destinationAmountInFlight = this.destinationAmountInFlight.subtract(
          highEndDestinationAmount
        )

        // If this packet failed, "refund" the delivery deficit so it may be retried
        if (deliveryDeficit.isPositive() && reply.isReject()) {
          this.availableDeliveryShortfall = this.availableDeliveryShortfall.add(deliveryDeficit)
        }
      }

      if (this.target?.type === PaymentType.FixedSend) {
        log.trace(
          'payment has sent %s of %s, %s in-flight',
          this.amountSent,
          this.target.maxSourceAmount,
          this.sourceAmountInFlight
        )
      } else if (this.target?.type === PaymentType.FixedDelivery) {
        log.trace(
          'payment has delivered %s of %s, %s in-flight',
          this.amountDelivered,
          this.target.minDeliveryAmount,
          this.destinationAmountInFlight
        )
      }

      this.updateReceiveMax(reply)
    }
  }

  private updateReceiveMax({ frames, log }: StreamReply) {
    frames
      ?.filter((frame): frame is StreamMaxMoneyFrame => frame.type === FrameType.StreamMaxMoney)
      .filter((frame) => frame.streamId.equals(DEFAULT_STREAM_ID))
      .forEach((frame) => {
        log.trace(
          'recipient told us the stream has received %s of up to %s',
          frame.totalReceived,
          frame.receiveMax
        )

        // Note: totalReceived *can* be greater than receiveMax! (`ilp-protocol-stream` allows receiving 1% more than the receiveMax)
        const receiveMax = Int.from(frame.receiveMax)

        // Remote receive max can only increase
        this.remoteReceiveMax = this.remoteReceiveMax?.orGreater(receiveMax) ?? receiveMax
      })
  }

  paymentComplete(): Promise<void> {
    return this.paymentStatus.promise
  }

  getAmountSent(): Int {
    return this.amountSent
  }

  getAmountDelivered(): Int {
    return this.amountDelivered
  }
}
