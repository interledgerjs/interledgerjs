import BigNumber from 'bignumber.js'
import { StreamMoneyFrame } from 'ilp-protocol-stream/dist/src/packet'
import { Maybe } from 'true-myth'
import { StreamController, StreamRequestBuilder } from '.'
import { PaymentState } from '..'
import { ceil, divide, floor, Integer, Rational } from '../utils'
import { DestinationAmountTracker } from './destination-tracker'
import { ExchangeRateController } from './exchange-rate'
import { SimpleCongestionController } from './liquidity-congestion'
import { MaxPacketAmountController } from './max-packet'
import { SourceAmountTracker } from './source-tracker'

export const DEFAULT_STREAM_ID = 1

export class AmountStrategy implements StreamController {
  private sourceTracker: SourceAmountTracker
  private destinationTracker: DestinationAmountTracker
  private rateController: ExchangeRateController
  private maxPacketController: MaxPacketAmountController
  private minExchangeRate: Rational

  constructor(
    sourceTracker: SourceAmountTracker,
    destinationTracker: DestinationAmountTracker,
    maxPacketController: MaxPacketAmountController,
    congestionController: SimpleCongestionController,
    rateController: ExchangeRateController,
    exchangeRate: Rational
  ) {
    this.sourceTracker = sourceTracker
    this.destinationTracker = destinationTracker
    this.maxPacketController = maxPacketController
    this.rateController = rateController
    this.minExchangeRate = exchangeRate
  }

  nextState(builder: StreamRequestBuilder) {
    // If fixed destination amount, use different strategy for setting packet amounts
    if (this.destinationTracker.getAmountToDeliver().isJust()) {
      this.applyFixedDestinationStrategy(builder)
    } else {
      this.applyFixedSourceStrategy(builder)
    }

    return PaymentState.SendMoney
  }

  applyFixedSourceStrategy(builder: StreamRequestBuilder) {
    // Aggregate all source packet amount ceilings
    const availableToSendLimit = this.sourceTracker.getAvailableToSend()
    const pathMaxPacketCeiling = this.maxPacketController.getMaxPacketAmount()
    const dustPreventionCeiling = this.reduceMaxPacketAmountToPreventDust(
      this.sourceTracker.getAvailableToSend(),
      pathMaxPacketCeiling
    )
    const sourceAmountCeilings = [availableToSendLimit, pathMaxPacketCeiling, dustPreventionCeiling]
    const sourceAmount = BigNumber.min(
      ...sourceAmountCeilings.filter(Maybe.isJust).map(o => o.value)
    ) as Integer

    // Aggregate all source amount floors

    // TODO Add floor to prevent rounding errors
    // TODO Add floor to prevent dust

    // TODO Add ceiling/floor validation

    // TODO Add congestion limit

    // TODO Add U64 ceiling

    builder.setSourceAmount(sourceAmount)

    const minDestinationAmount = sourceAmount
      .times(this.minExchangeRate)
      .integerValue(BigNumber.ROUND_CEIL)
    builder.setMinDestinationAmount(minDestinationAmount as Integer)

    if (sourceAmount.isGreaterThan(0)) {
      builder.addFrames(new StreamMoneyFrame(DEFAULT_STREAM_ID, 1))
    }
  }

  applyFixedDestinationStrategy(builder: StreamRequestBuilder) {
    // Aggregate all the destination packet amount ceilings

    const availableToDeliverLimit = this.destinationTracker.getAvailableToDeliver()
    // Convert path max packet to destination units using pessimistic exchange rate (underestimate)
    const pathMaxPacketCeiling = this.rateController.estimateDestinationAmount(
      this.maxPacketController.getMaxPacketAmount(),
      Maybe.just(this.rateController.getRateLowerBound()) // TODO What if there's no rate yet?
    )
    const dustPreventionCeiling = this.reduceMaxPacketAmountToPreventDust(
      this.destinationTracker.getAvailableToDeliver(),
      pathMaxPacketCeiling
    )
    const destinationAmountCeilings = [
      availableToDeliverLimit,
      pathMaxPacketCeiling,
      dustPreventionCeiling
    ]
    const targetDestinationAmount = BigNumber.min(
      ...destinationAmountCeilings.filter(Maybe.isJust).map(o => o.value)
    ) as Integer

    builder.log.debug('available to deliver: %s', this.destinationTracker.getAvailableToDeliver())
    builder.log.debug('remaining to deliver: %s', this.destinationTracker.getRemainingToDeliver())
    builder.log.debug('target destination amount: %s', targetDestinationAmount)
    builder.log.debug('lower bound rate: %s', this.rateController.getRateLowerBound())
    builder.log.debug('upper bound rate: %s', this.rateController.getRateUpperBound())

    // Aggregate all destination packet amount floors

    // TODO Add floor to prevent rounding errors
    // TODO Add floor to prevent dust

    // TODO Add ceiling/floor validation

    // TODO Add congestion limit

    // TODO Add U64 ceiling

    // TODO On the final packet, this *can* underestimate the source amount -- creating dust. How to improve this?

    // Estimate the minimum source amount in order to deliver this target
    // If it doesn't deliver the precise amount, that's okay, because it will help discover a more accurate rate
    const sourceAmount = this.rateController
      .estimateMinSourceAmount(
        Maybe.just(targetDestinationAmount),
        Maybe.just(this.rateController.getRateLowerBound())
      )
      .unsafelyUnwrap() // TODO Remove Maybes from this method and remove `unsafelyUnwrap`
    builder.setSourceAmount(sourceAmount)

    // TODO This is problematic if `minDestinationAmount` > targetDestinationAmount & availableToDeliver ...!
    const minDestinationAmount = sourceAmount
      .times(this.minExchangeRate)
      .integerValue(BigNumber.ROUND_CEIL)
    builder.setMinDestinationAmount(minDestinationAmount as Integer)

    if (sourceAmount.isGreaterThan(0)) {
      builder.addFrames(new StreamMoneyFrame(DEFAULT_STREAM_ID, 1))
    }
  }

  private reduceMaxPacketAmountToPreventDust(
    remainingAmount: Maybe<Integer>,
    maxPacketAmount: Maybe<Integer>
  ) {
    const numberRemainingPackets = remainingAmount
      .map(divide)
      .ap(maxPacketAmount)
      .chain(n => n)
      .map(ceil) // Increase amount of final packet by subtracting from other packets

    return remainingAmount
      .map(divide)
      .ap(numberRemainingPackets)
      .chain(n => n)
      .map(ceil)
  }

  private increaseMinPacketAmountToPreventDust(
    remainingAmount: Maybe<Integer>,
    minPacketAmount: Maybe<Integer>
  ) {
    const numberRemainingPackets = remainingAmount
      .map(divide)
      .ap(minPacketAmount)
      .chain(n => n)
      .map(floor) // Don't send the final packet -- distribute dust across other packets

    return remainingAmount
      .map(divide)
      .ap(numberRemainingPackets)
      .chain(n => n)
      .map(ceil)
  }
}
