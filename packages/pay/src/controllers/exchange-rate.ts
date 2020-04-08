import BigNumber from 'bignumber.js'
import { Maybe } from 'true-myth'
import { StreamController, StreamReply } from '.'
import { Integer, Rational, divide, add1, floor, ceil, multiply, subtract } from '../utils'

// TODO How should the realized rate change over time? How should old data points be invalidated?

/** Compute the realized exchange rate from Fulfills and probed rate from Rejects */
export class ExchangeRateController implements StreamController {
  /** Real exchnage rate determined from the recipient */
  private exchangeRate: Maybe<{
    /** Real exchange rate MUST be less than this (exclusive) */
    upperBound: Rational
    /** Real exchange rate MUST be greater than or equal to this (inclusive) */
    lowerBound: Rational
  }> = Maybe.nothing()

  private minExchangeRate: Rational

  constructor(minExchangeRate: Rational) {
    this.minExchangeRate = minExchangeRate
  }

  getRateUpperBound(): Rational {
    return this.exchangeRate.get('upperBound').unwrapOr(this.minExchangeRate)
  }

  getRateLowerBound(): Rational {
    return this.exchangeRate.get('lowerBound').unwrapOr(this.minExchangeRate)
  }

  applyFulfill({ sourceAmount, minDestinationAmount, destinationAmount }: StreamReply) {
    // Amount received must be at least the minimum in case the recipient lied
    const receivedAmount = BigNumber.max(
      minDestinationAmount,
      destinationAmount || new BigNumber(0)
    ) as Integer

    this.updateRate(sourceAmount, receivedAmount)
  }

  applyReject({ sourceAmount, destinationAmount }: StreamReply) {
    // No authentic reply if no destination amount
    if (!destinationAmount) {
      return
    }

    this.updateRate(sourceAmount, destinationAmount)
  }

  private updateRate(sourceAmount: Integer, receivedAmount: Integer) {
    // Since intermediaries floor packet amounts, the exchange rate cannot be precisely computed:
    // it's only known with some margin however. However, as we send packets of different sizes,
    // the upper and lower bounds should converge closer and closer to the real exchange rate.

    // Prevent divide-by-0 errors
    if (sourceAmount.isZero()) {
      return
    }

    const packetRateUpperBound = receivedAmount.plus(1).dividedBy(sourceAmount) as Rational
    const packetRateLowerBound = receivedAmount.dividedBy(sourceAmount) as Rational

    this.exchangeRate = Maybe.just(
      this.exchangeRate.match({
        // Set the initial exchange rate
        Nothing: () => ({
          upperBound: packetRateUpperBound,
          lowerBound: packetRateLowerBound
        }),
        Just: existingRate => {
          // If the new exchange rate fluctuated and is "out of bounds," reset it
          const isOutOfBounds =
            packetRateUpperBound.isLessThan(existingRate.lowerBound) ||
            packetRateLowerBound.isGreaterThan(existingRate.upperBound)
          if (isOutOfBounds) {
            return {
              upperBound: packetRateUpperBound,
              lowerBound: packetRateLowerBound
            }
          }

          // Otherwise, continue narrowing the bounds of the exchange rate
          return {
            upperBound: BigNumber.min(existingRate.upperBound, packetRateUpperBound) as Rational,
            lowerBound: BigNumber.max(existingRate.lowerBound, packetRateLowerBound) as Rational
          }
        }
      })
    )
  }

  // TODO This is still confusing/needs more clarity

  /** Estimate the maximum source amount that delivers the given destination amount */
  estimateMaxSourceAmount(
    amountToDeliver: Maybe<Integer>,
    exchangeRate: Maybe<Rational>
  ): Maybe<Integer> {
    return amountToDeliver
      .map(add1)
      .map(divide)
      .ap(exchangeRate)
      .chain(n => n)
      .map(floor)
  }

  /** Estimate the minimum source amount that delivers the given destination amount */
  estimateMinSourceAmount(
    amountToDeliver: Maybe<Integer>,
    exchangeRate: Maybe<Rational>
  ): Maybe<Integer> {
    return amountToDeliver
      .map(divide)
      .ap(exchangeRate)
      .chain(n => n)
      .map(ceil)
  }

  /** Estimate the amount delivered by the given source amount */
  estimateDestinationAmount(amountToSend: Maybe<Integer>, exchangeRate: Maybe<Rational>) {
    return amountToSend
      .map(multiply)
      .ap(exchangeRate)
      .map(floor)
  }

  // TODO It's possible the lower bound rate is less than the minimum rate... how to handle this?

  /** Compute difference between the lowest real rate and minimum exchange rate. */
  private getExchangeRateMarginOfError(): Maybe<Rational> {
    return Maybe.just(this.getRateLowerBound())
      .map(subtract)
      .ap(Maybe.just(this.minExchangeRate))
      .chain(n => n)
  }

  /**
   * Compute the minimum destination amount such that are no rounding errors.
   * Given the exchange rate is estimated correctly, all source amounts greater than
   * this should deliver their minimum destination amount based on the minimum
   * exchange rate. Amounts less than this *may* deliver at least the minimum,
   * but as amounts get smaller, the probability of failure due to rounding errors
   * increases.
   *
   * The less the exchange rate, the less the destination amount, so use the lower
   * bound rate to compute this floor.
   */
  getDestinationRoundingErrorFloor(): Maybe<Integer> {
    // Convert the minimum source amount into its corresponding minimum destination amount.
    return this.estimateDestinationAmount(
      this.getSourceRoundingErrorFloor(),
      Maybe.just(this.getRateLowerBound())
    )
  }

  /** TODO Add description here */
  getSourceRoundingErrorFloor(): Maybe<Integer> {
    // What source amount will deliver at least 1 unit given the rate is this margin of error?

    // Put another way, all amounts >= this source amount should deliver money without failing
    // due to rounding. If they fail due to an exchange rate error, it will be because the real
    // exchange rate turned out to be too low, and not because of an off-by-1 rounding error.

    // Amounts less than this *may* deliver money without failing due to rounding, but as amounts
    // get smaller, the probability of failure due to rounding errors increases.

    return this.estimateMinSourceAmount(
      Maybe.just(new BigNumber(1) as Integer),
      this.getExchangeRateMarginOfError().or(
        // TODO If there's no realized exchange rate yet,
        // default to 1% of the minimum exchange rate
        Maybe.just(this.minExchangeRate.times(0.01) as Rational)
      )
    )
  }

  // TODO Should these methods be removed?

  estimateHighEndSourceAmount(destinationAmount: Maybe<Integer>): Maybe<Integer> {
    return destinationAmount
      .map(add1)
      .map(divide)
      .ap(Maybe.just(this.getRateLowerBound()))
      .chain(n => n)
      .map(floor)
  }

  estimateLowEndSourceAmount(destinationAmount: Maybe<Integer>): Maybe<Integer> {
    return destinationAmount
      .map(divide)
      .ap(Maybe.just(this.getRateUpperBound()))
      .chain(n => n)
      .map(ceil)
  }
}
