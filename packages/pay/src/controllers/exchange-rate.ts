import BigNumber from 'bignumber.js'
import { StreamController, StreamReply } from '.'
import { Integer, Rational } from '../utils'
import { PaymentError } from '..'

// TODO How should the realized rate change over time? How should old data points be invalidated?

/** Compute the realized exchange rate from Fulfills and probed rate from Rejects */
export class ExchangeRateController implements StreamController {
  private static DEFAULT_SLIPPAGE = 0.01

  /** Real exchnage rate determined from the recipient */
  private exchangeRate?: {
    /** Real exchange rate MUST be less than this ratio (exclusive): sent, received, rate */
    upperBound: [Integer, Integer, Rational]
    /** Real exchange rate MUST be greater than or equal to this ratio (inclusive): sent, received, rate */
    lowerBound: [Integer, Integer, Rational]
  }

  private packetAmounts: Map<string, Integer> = new Map()

  private minExchangeRate?: Rational

  setMinExchangeRate(
    exchangeRate: Rational,
    slippage = ExchangeRateController.DEFAULT_SLIPPAGE
  ): Rational | PaymentError {
    if (slippage === 1 || exchangeRate.isZero()) {
      return new BigNumber(0) as Rational
    }

    if (slippage < 0 || slippage > 1 || Number.isNaN(slippage)) {
      return PaymentError.InvalidSlippage
    }

    const minExchangeRate = exchangeRate.times(1 - slippage) as Rational
    if (this.getRateLowerBound()?.isGreaterThanOrEqualTo(minExchangeRate)) {
      this.minExchangeRate = minExchangeRate
      return minExchangeRate
    } else {
      return PaymentError.InsufficientExchangeRate
    }
  }

  getMinExchangeRate(): Rational | undefined {
    return this.minExchangeRate
  }

  getRateUpperBound(): Rational | undefined {
    return this.exchangeRate?.upperBound[2]
  }

  getRateLowerBound(): Rational | undefined {
    return this.exchangeRate?.lowerBound[2]
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
    if (destinationAmount) {
      this.updateRate(sourceAmount, destinationAmount)
    }
  }

  private updateRate(sourceAmount: Integer, receivedAmount: Integer) {
    // Since intermediaries floor packet amounts, the exchange rate cannot be precisely computed:
    // it's only known with some margin however. However, as we send packets of varying sizes,
    // the upper and lower bounds should converge closer and closer to the real exchange rate.

    // Prevent divide-by-0 errors
    // Sending 0... is not useful
    if (sourceAmount.isZero()) {
      return
    }

    const previousReceivedAmount = this.packetAmounts.get(sourceAmount.toString())
    if (previousReceivedAmount && !previousReceivedAmount.isEqualTo(receivedAmount)) {
      // If the delivery amount is different, reset the entire exchange rate
      delete this.exchangeRate
    }

    this.packetAmounts.set(sourceAmount.toString(), receivedAmount)

    // TODO Replace BigNumber with Ratio and remove this roudning mode nonsense once and for all?

    BigNumber.set({ ROUNDING_MODE: BigNumber.ROUND_CEIL }) // Otherwise some inequalities won't work
    const packetRateUpperBound = receivedAmount.plus(1).dividedBy(sourceAmount) as Rational

    BigNumber.set({ ROUNDING_MODE: BigNumber.ROUND_CEIL })
    const packetRateLowerBound = receivedAmount.dividedBy(sourceAmount) as Rational

    BigNumber.set({ ROUNDING_MODE: BigNumber.ROUND_HALF_UP }) // Reset to default rounding mode

    if (!this.exchangeRate) {
      // Set the initial exchange rate
      this.exchangeRate = {
        upperBound: [sourceAmount, receivedAmount, packetRateUpperBound],
        lowerBound: [sourceAmount, receivedAmount, packetRateLowerBound]
      }
    } else {
      // If the new exchange rate fluctuated and is "out of bounds," reset it
      const isOutOfBounds =
        packetRateUpperBound.isLessThan(this.exchangeRate.lowerBound[2]) ||
        packetRateLowerBound.isGreaterThanOrEqualTo(this.exchangeRate.upperBound[2])
      if (isOutOfBounds) {
        this.exchangeRate = {
          upperBound: [sourceAmount, receivedAmount, packetRateUpperBound],
          lowerBound: [sourceAmount, receivedAmount, packetRateLowerBound]
        }
      } else {
        // Otherwise, continue narrowing the bounds of the exchange rate
        this.exchangeRate = {
          upperBound: this.exchangeRate.upperBound[2].isLessThan(packetRateUpperBound)
            ? this.exchangeRate.upperBound
            : [sourceAmount, receivedAmount.plus(1) as Integer, packetRateUpperBound],
          lowerBound: this.exchangeRate.lowerBound[2].isGreaterThan(packetRateLowerBound)
            ? this.exchangeRate.lowerBound
            : [sourceAmount, receivedAmount, packetRateLowerBound]
        }
      }
    }
  }

  /**
   * Estimate the source amount that delivers the given destination amount.
   * (1) Low-end estimate: lowest source amount that *may* deliver the given destination
   *     amount (TODO won't overdeliver, but may underdeliver?).
   * (2) High-end estimate: lowest source amount that *must* deliver at least the given
   *     destination amount (TODO may overdeliver, won't underdeliver?).
   */
  estimateSourceAmount(amountToDeliver: Integer): [Integer, Integer] | undefined {
    if (
      !this.exchangeRate ||
      // Ensure denominator is not 0
      this.exchangeRate.upperBound[1].isZero() ||
      this.exchangeRate.lowerBound[1].isZero()
    ) {
      return
    }

    const sourceAmount = amountToDeliver
      .times(this.exchangeRate.upperBound[0])
      .dividedBy(this.exchangeRate.upperBound[1])
    const lowEndSource = sourceAmount.isInteger()
      ? sourceAmount.plus(1)
      : sourceAmount.integerValue(BigNumber.ROUND_CEIL)

    const highEndSource = amountToDeliver
      .times(this.exchangeRate.lowerBound[0])
      .dividedBy(this.exchangeRate.lowerBound[1])
      .integerValue(BigNumber.ROUND_CEIL)

    return [lowEndSource as Integer, highEndSource as Integer]
  }

  /** TODO Explain differences between the two estimates */
  estimateDestinationAmount(amountToSend: Integer): [Integer, Integer] | undefined {
    if (
      !this.exchangeRate ||
      // Ensure denominator is 0
      this.exchangeRate.upperBound[0].isZero() ||
      this.exchangeRate.lowerBound[0].isZero()
    ) {
      return
    }

    const lowEndDestination = amountToSend
      .times(this.exchangeRate.lowerBound[1])
      .dividedBy(this.exchangeRate.lowerBound[0])
      .integerValue(BigNumber.ROUND_DOWN)

    // Since upper bound exchange rate is exclusive:
    // If source amount converts exactly to an integer, destination amount MUST be 1 below
    // If source amount doesn't convert precisely, we can't narrow it any better than that amount ¯\_(ツ)_/¯
    const destinationAmount = amountToSend
      .times(this.exchangeRate.upperBound[1])
      .dividedBy(this.exchangeRate.upperBound[0])
    const highEndDestination = destinationAmount.isInteger()
      ? BigNumber.max(0, destinationAmount.minus(1))
      : destinationAmount.integerValue(BigNumber.ROUND_DOWN)

    return [lowEndDestination as Integer, highEndDestination as Integer]
  }
}
