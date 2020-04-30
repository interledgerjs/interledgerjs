import {
  ControllerMap,
  StreamController,
  StreamRequestBuilder,
  StreamRequest,
  StreamReply,
  isFulfillable,
  SendState
} from '.'
import { Integer, SAFE_ZERO, toBigNumber } from '../utils'
import BigNumber from 'bignumber.js'
import {
  StreamMaxMoneyFrame,
  FrameType,
  StreamMoneyFrame
} from 'ilp-protocol-stream/dist/src/packet'
import Long from 'long'
import { MaxPacketAmountController } from './max-packet'
import { ExchangeRateController } from './exchange-rate'
import { AssetScale } from '../setup/open-payments'
import { PaymentError } from '..'

export const DEFAULT_STREAM_ID = Long.fromNumber(1, true)

export enum PaymentType {
  FixedSend,
  FixedDelivery
}

export type PaymentTarget =
  | {
      type: PaymentType.FixedSend
      amountToSend: Integer
    }
  | {
      type: PaymentType.FixedDelivery
      amountToDeliver: Integer
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
      ? this.applyFixedSendStrategy(builder)
      : this.applyFixedDeliveryStrategy(builder)
  }

  private applyFixedSendStrategy(builder: StreamRequestBuilder): SendState | PaymentError {
    const { log } = builder

    if (this.target?.type !== PaymentType.FixedSend) {
      return SendState.Ready
    }

    const overpaidFixedSend = this.amountSent.isGreaterThan(this.target.amountToSend)
    if (overpaidFixedSend) {
      log.error(
        'ending payment: overpaid source amount limit. sent %s of %s',
        this.amountSent,
        this.target?.amountToSend
      )
      return SendState.End // TODO Replace with `PaymentError`
    }

    const paidFixedSend =
      this.amountSent.isEqualTo(this.target.amountToSend) && this.getAmountInFlight().isZero()
    if (paidFixedSend) {
      log.debug('payment complete: paid fixed source amount. sent %s', this.amountSent)
      return SendState.End // TODO Replace with `PaymentError`
    }

    // TODO Compare estimated remaining to deliver vs receive max?

    const availableToSendLimit = this.target.amountToSend
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
    }

    // TODO Should this support sending by source amount with no min exchange rate?
    //      Since min destination is 0, the packets will be unfulfillable if not

    if (sourceAmount.isGreaterThan(0)) {
      builder.addFrames(new StreamMoneyFrame(DEFAULT_STREAM_ID, 1))
    }

    return SendState.Ready
  }

  private applyFixedDeliveryStrategy(builder: StreamRequestBuilder): SendState | PaymentError {
    const { log } = builder

    if (this.target?.type !== PaymentType.FixedDelivery) {
      return SendState.Ready
    }

    const remainingToDeliver = this.target.amountToDeliver.minus(this.amountDelivered)
    const overpaidFixedDelivery = remainingToDeliver.isLessThan(0)
    if (overpaidFixedDelivery) {
      log.error(
        'ending payment: overpaid fixed destination amount. delivered %s of %s',
        this.amountDelivered,
        this.target.amountToDeliver
      )
      return SendState.End // TODO Replace with `PaymentError`
    }

    // TODO What should happen if remainingToDeliver=0 but inFlight>0 ?

    // TODO Rather, should this check if destination amount inflight is 0?
    const paidFixedDelivery = remainingToDeliver.isZero() && this.getAmountInFlight().isZero()
    if (paidFixedDelivery) {
      log.debug(
        'payment complete: paid fixed destination amount. delivered %s',
        this.amountDelivered
      )
      return SendState.End // TODO Replace with `PaymentError`
    }

    // // Is the recipient's advertised `receiveMax` less than the fixed destination amount?
    const incompatibleReceiveMax = this.target.amountToDeliver.isGreaterThan(
      this.remoteReceiveMax ?? Infinity
    )
    if (incompatibleReceiveMax) {
      log.error(
        'ending payment: fixed destination amount is too much for recipient. amount to deliver: %s, receive max: %s',
        this.target.amountToDeliver,
        this.remoteReceiveMax
      )
      return SendState.End // TODO Replace with `PaymentError`
    }

    // Estimate the current amount in-flight that might get delivered to the recipient
    const highEndAmountInFlight = [...this.inFlightAmounts.values()].reduce(
      (total, [sourceAmount, minDestination]) => {
        const deliveryEstimate =
          this.controllers.get(ExchangeRateController).estimateDestinationAmount(sourceAmount) ?? []
        const highEstimate = deliveryEstimate[1] ?? new BigNumber(0)
        return total.plus(BigNumber.max(minDestination, highEstimate))
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
      // TODO
      return SendState.Wait
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
      dustPreventionCeiling
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

    // TODO Is there ever a case where both the low estimate and high estimate are known
    //      to precisely convert to the destination amount?
    //      In that case, it should default to the low estimate, right?

    // TODO Alternatively -- set sourceAmount to lower target destination, use normal min destination amount
    // TODO That was incoherent but basically use the commented lines instead
    builder.setSourceAmount(sourceAmount).setMinDestinationAmount(targetDestinationAmount)

    // TODO Where should the min destination amount checking exist?
    const minExchangeRate = this.controllers.get(ExchangeRateController).getMinExchangeRate()
    if (minExchangeRate) {
      const minDestinationAmount = sourceAmount
        .times(minExchangeRate)
        .integerValue(BigNumber.ROUND_DOWN)
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

  applyPrepare(request: StreamRequest) {
    const { sequence, sourceAmount, minDestinationAmount, log } = request
    if (isFulfillable(request)) {
      this.inFlightAmounts.set(sequence, [sourceAmount, minDestinationAmount])
    }
  }

  applyFulfill(reply: StreamReply) {
    const { sequence, sourceAmount, minDestinationAmount, destinationAmount } = reply

    // TODO Add log somewhere (maybe when sending packet?) of the minimum destination amount/target amount

    // Delivered amount must be *at least* the minimum acceptable amount we told the receiver
    // No matter what, since they fulfilled it, we must assume they got at least the minimum
    let amountDelivered: BigNumber
    if (!destinationAmount) {
      reply.log.warn(
        'packet fulfilled with no authentic STREAM data: assuming minimum of %s got delivered',
        minDestinationAmount
      )
      amountDelivered = minDestinationAmount
    } else if (destinationAmount.isLessThan(minDestinationAmount)) {
      reply.log.warn(
        'packet wrongly fulfilled. claimed destination amount of %s less than minimum of %s. assuming minimum got delivered',
        destinationAmount,
        minDestinationAmount
      )
      amountDelivered = minDestinationAmount

      // TODO Should this end the payment immediately? Why would this ever happen legitimately?
      // TODO Should `PaymentError` be allowed as a return value from `applyFulfill` / `applyReject`?
    } else {
      reply.log.debug(
        'packet sent %s, delivered %s, min destination %s.',
        sourceAmount,
        destinationAmount,
        minDestinationAmount
      )
      amountDelivered = destinationAmount
    }

    this.amountSent = this.amountSent.plus(sourceAmount) as Integer
    this.amountDelivered = this.amountDelivered.plus(amountDelivered) as Integer

    this.inFlightAmounts.delete(sequence)
    this.updateReceiveMax(reply)
  }

  applyReject(reply: StreamReply) {
    if (reply.destinationAmount?.isLessThan(reply.minDestinationAmount)) {
      reply.log.debug(
        'exchange rate failure: destination amount of %s was below minimum of %s',
        reply.destinationAmount,
        reply.minDestinationAmount
      )
    }

    this.inFlightAmounts.delete(reply.sequence)
    this.updateReceiveMax(reply)
  }

  private updateReceiveMax({ sequence, responseFrames, log }: StreamReply) {
    responseFrames
      ?.filter((frame): frame is StreamMaxMoneyFrame => frame.type === FrameType.StreamMaxMoney)
      .filter(frame => frame.streamId.equals(DEFAULT_STREAM_ID))
      .forEach(frame => {
        log.trace(
          'recipient told us this stream can receive up to: %s and has received: %s so far',
          frame.receiveMax,
          frame.totalReceived
        )

        const receiveMax = toBigNumber(frame.receiveMax) as Integer
        const totalReceived = toBigNumber(frame.totalReceived) as Integer

        // Frame is invalid
        if (!receiveMax.isGreaterThanOrEqualTo(totalReceived)) {
          return
        }

        // "Fast-forward" the total received if it's not synchronized with the recipient
        // This case occurs if an intermediary or the recipient dropped a Fulfill, causing them to lose money
        const oldestInFlightPacket = Math.min(sequence, ...this.inFlightAmounts.keys())
        // Only fast-forward in response to the oldest in-flight packet: return packets received out-of-order could overcount the delivered amount
        const isOldestInFlight = oldestInFlightPacket === sequence
        if (isOldestInFlight) {
          if (totalReceived.isGreaterThan(this.amountDelivered)) {
            log.warn(
              'fast forwarding total delivered from %s to %s. other nodes in path may have lost money',
              this.amountDelivered,
              totalReceived
            )
            this.amountDelivered = totalReceived
          }

          // If totalReceived is less than the amount we know we delivered, we shouldn't do anything,
          // since Rust and Java return `StreamMaxMoney` frames with totalReceived of 0
        }

        // Remote receive max can only increase
        this.remoteReceiveMax = this.remoteReceiveMax
          ? (BigNumber.max(this.remoteReceiveMax, receiveMax) as Integer)
          : receiveMax
      })
  }

  getAmountInFlight(): Integer {
    return [...this.inFlightAmounts.values()]
      .map(([sourceAmount]) => sourceAmount)
      .reduce((a, b) => a.plus(b) as Integer, new BigNumber(0) as Integer) // TODO Remove cast
  }

  generateReceipt(sourceScale: AssetScale, destinationScale: AssetScale) {
    return {
      amountSent: this.amountSent.shiftedBy(-sourceScale),
      amountInFlight: this.getAmountInFlight().shiftedBy(-sourceScale),
      amountDelivered: this.amountDelivered.shiftedBy(-destinationScale)
    }
  }

  private reduceMaxPacketAmountToPreventDust(
    remainingAmount: Integer,
    maxPacketAmount: Integer | undefined
  ): Integer | undefined {
    if (!maxPacketAmount || maxPacketAmount.isZero()) {
      return
    }

    const numberRemainingPackets = remainingAmount
      .dividedBy(maxPacketAmount)
      .integerValue(BigNumber.ROUND_CEIL) // Increase amount of final packet by subtracting from other packets

    if (numberRemainingPackets.isZero()) {
      return
    }

    return remainingAmount
      .dividedBy(numberRemainingPackets)
      .integerValue(BigNumber.ROUND_CEIL) as Integer
  }

  private increaseMinPacketAmountToPreventDust(
    remainingAmount: Integer,
    minPacketAmount: Integer | undefined
  ): Integer | undefined {
    if (!minPacketAmount || minPacketAmount.isZero()) {
      return
    }

    const numberRemainingPackets = remainingAmount
      .dividedBy(minPacketAmount)
      .integerValue(BigNumber.ROUND_DOWN) // Don't send the final packet -- distribute dust across other packets

    if (numberRemainingPackets.isZero()) {
      return
    }

    return remainingAmount
      .dividedBy(numberRemainingPackets)
      .integerValue(BigNumber.ROUND_CEIL) as Integer
  }
}
