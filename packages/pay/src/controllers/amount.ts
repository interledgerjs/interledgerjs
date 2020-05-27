import {
  ControllerMap,
  StreamController,
  StreamRequestBuilder,
  StreamRequest,
  StreamReply,
  isFulfillable,
  SendState,
} from '.'
import { Integer, SAFE_ZERO, toBigNumber } from '../utils'
import BigNumber from 'bignumber.js'
import {
  StreamMaxMoneyFrame,
  FrameType,
  StreamMoneyFrame,
} from 'ilp-protocol-stream/dist/src/packet'
import { MaxPacketAmountController } from './max-packet'
import { ExchangeRateController } from './exchange-rate'
import { AssetScale } from '../setup/open-payments'
import { PaymentError } from '..'

export const DEFAULT_STREAM_ID = 1

export enum PaymentType {
  FixedSend,
  FixedDelivery,
}

export type PaymentTarget =
  | {
      type: PaymentType.FixedSend
      amountToSend: Integer
    }
  | {
      type: PaymentType.FixedDelivery
      amountToDeliver: Integer
      // TODO Also track the max source amount that was provided here and ensure it's always less than that?
    }

export class AmountController implements StreamController {
  private target?: PaymentTarget

  private amountSent: Integer = SAFE_ZERO
  private amountDelivered: Integer = SAFE_ZERO

  /** Mapping of sequence number to [sourceAmount, minDestinationAmount] for all in-flight requests */
  private inFlightAmounts: Map<number, [Integer, Integer]> = new Map()

  private remoteReceiveMax?: Integer

  private controllers: ControllerMap

  constructor(controllers: ControllerMap) {
    this.controllers = controllers
  }

  nextState(builder: StreamRequestBuilder): SendState | PaymentError {
    return !this.target
      ? SendState.Ready // No fixed source or delivery amount set
      : this.target.type === PaymentType.FixedSend
      ? this.applyFixedSendStrategy(builder, this.target.amountToSend)
      : this.applyFixedDeliveryStrategy(builder, this.target.amountToDeliver)
  }

  private applyFixedSendStrategy(
    builder: StreamRequestBuilder,
    amountToSend: Integer
  ): SendState | PaymentError {
    const { log } = builder

    const overpaidFixedSend = this.amountSent.isGreaterThan(amountToSend)
    if (overpaidFixedSend) {
      log.error(
        'ending payment: overpaid source amount limit. sent %s of %s',
        this.amountSent,
        amountToSend
      )
      return PaymentError.OverpaidFixedSend
    }

    const paidFixedSend =
      this.amountSent.isEqualTo(amountToSend) && this.getAmountInFlight().isZero()
    if (paidFixedSend) {
      log.debug('payment complete: paid fixed source amount. sent %s', this.amountSent)
      return SendState.End
    }

    // TODO Compare estimated remaining to deliver vs receive max?

    const availableToSendLimit = amountToSend
      .minus(this.amountSent)
      .minus(this.getAmountInFlight()) as Integer
    const isBlocked = availableToSendLimit.isLessThanOrEqualTo(0)
    if (isBlocked) {
      return SendState.Wait
    }

    // Aggregate all source packet amount ceilings
    const pathMaxPacketCeiling = this.controllers
      .get(MaxPacketAmountController)
      .getMaxPacketAmount()
    const dustPreventionCeiling = this.reduceMaxPacketAmountToPreventDust(
      availableToSendLimit,
      pathMaxPacketCeiling
    )
    const sourceAmountCeilings = [availableToSendLimit, pathMaxPacketCeiling, dustPreventionCeiling]
    const sourceAmount = BigNumber.min(
      ...sourceAmountCeilings.filter((o): o is Integer => !!o)
    ) as Integer

    // TODO Aggregate all source amount floors
    // - Add floor to prevent rounding errors
    // - Add floor to prevent dust
    // - Add ceiling/floor validation
    // - Add congestion limit
    // - Add U64 ceiling

    builder.setSourceAmount(sourceAmount)

    // TODO Should this use lower bound exchange rate to set the min destination amount? (e.g. precise delivery?)
    // Or does it not matter since this is a fixed-source payment?

    const minExchangeRate = this.controllers.get(ExchangeRateController).getMinExchangeRate()
    if (minExchangeRate) {
      const minDestinationAmount = sourceAmount
        .times(minExchangeRate)
        .integerValue(BigNumber.ROUND_CEIL)
      builder.setMinDestinationAmount(minDestinationAmount as Integer)
    } else {
      // TODO If rate enforcement is disabled, set arbitrary low minimum destination amount
      // (If this is 0, packet will be sent unfulfillable)
      builder.setMinDestinationAmount(new BigNumber(1) as Integer)
    }

    if (sourceAmount.isGreaterThan(0)) {
      builder.addFrames(new StreamMoneyFrame(DEFAULT_STREAM_ID, 1))
    }

    return SendState.Ready
  }

  private applyFixedDeliveryStrategy(
    builder: StreamRequestBuilder,
    amountToDeliver: Integer
  ): SendState | PaymentError {
    const { log } = builder

    const remainingToDeliver = amountToDeliver.minus(this.amountDelivered)
    const overpaidFixedDelivery = remainingToDeliver.isLessThan(0)
    if (overpaidFixedDelivery) {
      log.debug(
        'payment complete: overpaid fixed destination amount. delivered %s of %s',
        this.amountDelivered,
        amountToDeliver
      )
      return SendState.End
    }

    // TODO Rather, should this check if destination amount inflight is 0?
    const paidFixedDelivery = remainingToDeliver.isZero() && this.getAmountInFlight().isZero()
    if (paidFixedDelivery) {
      log.debug(
        'payment complete: paid fixed destination amount. delivered %s',
        this.amountDelivered
      )
      return SendState.End
    }

    // // Is the recipient's advertised `receiveMax` less than the fixed destination amount?
    const incompatibleReceiveMax = amountToDeliver.isGreaterThan(this.remoteReceiveMax ?? Infinity)
    if (incompatibleReceiveMax) {
      log.error(
        'ending payment: fixed destination amount is too much for recipient. amount to deliver: %s, receive max: %s',
        amountToDeliver,
        this.remoteReceiveMax
      )
      return PaymentError.IncompatibleReceiveMax
    }

    // Estimate the current amount in-flight that might get delivered to the recipient
    const highEndAmountInFlight = [...this.inFlightAmounts.values()].reduce(
      (total, [sourceAmount, minDestination]) => {
        const deliveryEstimate =
          this.controllers
            .get(ExchangeRateController)
            .estimateDestinationAmount(sourceAmount)?.[1] ?? new BigNumber(0)
        return total.plus(BigNumber.max(minDestination, deliveryEstimate))
      },
      new BigNumber(0)
    )
    // TODO When I do this, it seems to make the packet sizes very unpredictable...
    // Add 10% to overestimate the amount that could get delivered
    // .times(1.1)
    // .integerValue(BigNumber.ROUND_CEIL)

    const availableToDeliver = remainingToDeliver.minus(highEndAmountInFlight)
    const isBlocked = availableToDeliver.isLessThanOrEqualTo(0)
    if (isBlocked) {
      return SendState.Wait // TODO What if it never set the amount in this case?
    }

    // Aggregate all the destination packet amount ceilings

    // Convert path max packet to destination units using pessimistic exchange rate using an underestimate
    let pathMaxPacketAmount = this.controllers.get(MaxPacketAmountController).getMaxPacketAmount()
    if (pathMaxPacketAmount) {
      pathMaxPacketAmount = this.controllers
        .get(ExchangeRateController)
        .estimateDestinationAmount(pathMaxPacketAmount)?.[0]
    }

    const dustPreventionCeiling = this.reduceMaxPacketAmountToPreventDust(
      availableToDeliver as Integer,
      pathMaxPacketAmount
    )

    const destinationAmountCeilings = [
      availableToDeliver,
      pathMaxPacketAmount,
      dustPreventionCeiling,
    ]
    const targetDestinationAmount = BigNumber.min(
      ...destinationAmountCeilings.filter(BigNumber.isBigNumber) // Note: BigNumber.min -> NaN if any parameter is `undefined`
    ) as Integer

    // TODO Aggregate all destination packet amount floors
    // - Add floor to prevent rounding errors
    // - Add floor to prevent dust
    // - Add ceiling/floor validation
    // - Add congestion limit
    // - Add U64 ceiling

    // Estimate the minimum source amount in order to deliver this target
    // If it doesn't deliver the precise amount, that's okay, because it will help discover a more accurate rate
    const sourceAmountEstimate = this.controllers
      .get(ExchangeRateController)
      .estimateSourceAmount(targetDestinationAmount)
    if (!sourceAmountEstimate) {
      return SendState.End // TODO If we don't have any rate to estimate source amounts... what would you do?! [shrug]
    }

    // TODO Choose the source amount in between the two!? Nice!
    // This functionally performs a binary search to iteratively discover through F99s
    // the minimum source amount that delivers some destination amount
    // (assuming the target destination amount is roughly the same, which it should be)
    // Trying to minimize the source amount also lowers the risk of overdelivery
    // Setting minimium destination amount to the target prevents underdelivery
    const sourceAmount = sourceAmountEstimate[1]
      .minus(sourceAmountEstimate[0])
      .dividedBy(2)
      .integerValue(BigNumber.ROUND_DOWN)
      .plus(sourceAmountEstimate[0]) as Integer

    // TODO Now, estimate the destination amount this delivers to accurately set the min destination amount
    //      as high as possible?
    // const minDestination = this.controllers
    //   .get(ExchangeRateController)
    //   .estimateDestinationAmount(sourceAmount)?.[0]
    // if (!minDestination) {
    //   throw new Error('TODO Failed to compute')
    // }

    // TODO Is there ever a case where both the low estimate and high estimate are known
    //      to precisely convert to the destination amount?
    //      In that case, it should default to the low estimate, right?

    // TODO Alternatively -- set sourceAmount to lower target destination, use normal min destination amount
    // TODO That was incoherent but basically use the commented lines instead
    builder.setSourceAmount(sourceAmount).setMinDestinationAmount(targetDestinationAmount) // TODO Change back to target destination?

    // TODO There should be a more robust check here to ensure ALL packets can clear the min exchange rate
    //      given the lower bound rate.

    // TODO Where should the min destination amount checking exist?
    const minExchangeRate = this.controllers.get(ExchangeRateController).getMinExchangeRate()
    if (minExchangeRate) {
      const minDestinationAmount = sourceAmount
        .times(minExchangeRate)
        .integerValue(BigNumber.ROUND_CEIL)
      if (targetDestinationAmount.isLessThan(minDestinationAmount)) {
        return PaymentError.InsufficientExchangeRate
      }
    }

    if (sourceAmount.isGreaterThan(0)) {
      builder.addFrames(new StreamMoneyFrame(DEFAULT_STREAM_ID, 1))
    }

    return SendState.Ready
  }

  // TODO This should generate the parameters that are provided in the quote!
  setPaymentTarget(target: PaymentTarget) {
    // TODO Estimate the delivery amount here
    //      (1) Ensure it's compatible with `receiveMax`
    ///     (2) Ensure it's the same as the fixed delivery amount!
    this.target = target
  }

  applyRequest(request: StreamRequest) {
    const { sequence, sourceAmount, minDestinationAmount, log } = request

    if (isFulfillable(request)) {
      this.inFlightAmounts.set(sequence, [sourceAmount, minDestinationAmount])
    }

    return (reply: StreamReply) => {
      if (reply.isFulfill()) {
        const destinationAmount = reply.destinationAmount

        // Delivered amount must be *at least* the minimum acceptable amount we told the receiver
        // No matter what, since they fulfilled it, we must assume they got at least the minimum
        let amountDelivered: BigNumber
        if (!destinationAmount) {
          log.warn(
            'packet fulfilled with no authentic STREAM data: assuming minimum of %s got delivered',
            minDestinationAmount
          )
          amountDelivered = minDestinationAmount
        } else if (destinationAmount.isLessThan(minDestinationAmount)) {
          log.warn(
            'packet wrongly fulfilled. claimed destination amount of %s less than minimum of %s. assuming minimum got delivered',
            destinationAmount,
            minDestinationAmount
          )
          amountDelivered = minDestinationAmount

          // TODO Should this end the payment immediately? Why would this ever happen legitimately?
          // TODO Should `PaymentError` be allowed as a return value from `applyFulfill` / `applyReject`?
        } else {
          log.debug(
            'packet sent %s, delivered %s, min destination %s.',
            sourceAmount,
            destinationAmount,
            minDestinationAmount
          )
          amountDelivered = destinationAmount
        }

        this.amountSent = this.amountSent.plus(sourceAmount) as Integer
        this.amountDelivered = this.amountDelivered.plus(amountDelivered) as Integer
      }

      this.inFlightAmounts.delete(sequence)
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

        // Note: totalReceived *can* be greater than receiveMax!
        // `ilp-protocol-stream` allows receiving 1% more than the receiveMax
        const receiveMax = toBigNumber(frame.receiveMax) as Integer

        // TODO Add "fast forward" functionality using `totalReceived` to account for dropped Fulfills
        //      The only problem is, it seems very complicated to implement without race conditions
        //      since you can't guarantee the order packets are delivered to the receiver

        // Remote receive max can only increase
        this.remoteReceiveMax = this.remoteReceiveMax
          ? (BigNumber.max(this.remoteReceiveMax, receiveMax) as Integer)
          : receiveMax
      })
  }

  // TODO Cache this to not continue repeating this
  getAmountInFlight(): Integer {
    return [...this.inFlightAmounts.values()]
      .map(([sourceAmount]) => sourceAmount)
      .reduce((a, b) => a.plus(b) as Integer, new BigNumber(0) as Integer) // TODO Remove cast
  }

  generateReceipt(sourceScale: AssetScale, destinationScale: AssetScale) {
    return {
      amountSent: this.amountSent.shiftedBy(-sourceScale),
      amountInFlight: this.getAmountInFlight().shiftedBy(-sourceScale),
      amountDelivered: this.amountDelivered.shiftedBy(-destinationScale),
    }
  }

  private reduceMaxPacketAmountToPreventDust(
    remainingAmount: Integer, // TODO Add type assertion somewhere that this must be greater than 0
    maxPacketAmount?: Integer
  ): Integer | undefined {
    if (!maxPacketAmount || maxPacketAmount.isZero()) {
      return
    }

    const numberRemainingPackets = remainingAmount
      .dividedBy(maxPacketAmount)
      .integerValue(BigNumber.ROUND_CEIL) // Increase amount of final packet by subtracting from other packets

    // `numberRemainingPackets` should always be non-zero since `remainingAmount` is non-zero
    // Therefore, no divide-by-zero error

    return remainingAmount
      .dividedBy(numberRemainingPackets)
      .integerValue(BigNumber.ROUND_CEIL) as Integer
  }

  // TODO Move this elsewhere?
  // private increaseMinPacketAmountToPreventDust(
  //   remainingAmount: Integer,
  //   minPacketAmount?: Integer
  // ): Integer | undefined {
  //   if (!minPacketAmount || minPacketAmount.isZero()) {
  //     return
  //   }

  //   const numberRemainingPackets = remainingAmount
  //     .dividedBy(minPacketAmount)
  //     .integerValue(BigNumber.ROUND_DOWN) // Don't send the final packet -- distribute dust across other packets

  //   if (numberRemainingPackets.isZero()) {
  //     return
  //   }

  //   return remainingAmount
  //     .dividedBy(numberRemainingPackets)
  //     .integerValue(BigNumber.ROUND_CEIL) as Integer
  // }
}
