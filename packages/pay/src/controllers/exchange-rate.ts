import { Logger } from 'ilp-logger'
import { StreamController } from '.'
import { StreamReply, StreamRequest } from '../request'
import { Int, PositiveInt, Ratio } from '../utils'

/** Track exchange rates and estimate source/destination amount */
export class ExchangeRateCalculator {
  /** Realized exchange rate is less than this ratio (exclusive): destination / source */
  upperBoundRate: Ratio

  /** Realized exchange rate is greater than or equal to this ratio (inclusive): destination / source */
  lowerBoundRate: Ratio

  /** Mapping of packet received amounts to its most recent sent amount */
  private sentAmounts = new Map<bigint, PositiveInt>()

  /** Mapping of packet sent amounts to its most recent received amount */
  private receivedAmounts = new Map<bigint, Int>()

  constructor(sourceAmount: PositiveInt, receivedAmount: Int, log: Logger) {
    this.upperBoundRate = new Ratio(receivedAmount.add(Int.ONE), sourceAmount)
    this.lowerBoundRate = new Ratio(receivedAmount, sourceAmount)
    log.debug('setting initial rate to [%s, %s]', this.lowerBoundRate, this.upperBoundRate)

    this.sentAmounts.set(receivedAmount.value, sourceAmount)
    this.receivedAmounts.set(sourceAmount.value, receivedAmount)
  }

  updateRate(sourceAmount: PositiveInt, receivedAmount: Int, log: Logger): void {
    // Since intermediaries floor packet amounts, the exchange rate cannot be precisely computed:
    // it's only known with some margin however. However, as we send packets of varying sizes,
    // the upper and lower bounds should converge closer and closer to the real exchange rate.

    const packetUpperBoundRate = new Ratio(receivedAmount.add(Int.ONE), sourceAmount)
    const packetLowerBoundRate = new Ratio(receivedAmount, sourceAmount)

    const previousReceivedAmount = this.receivedAmounts.get(sourceAmount.value)

    // If the exchange rate fluctuated and is "out of bounds," reset it
    const shouldResetExchangeRate =
      (previousReceivedAmount && !previousReceivedAmount.isEqualTo(receivedAmount)) ||
      packetUpperBoundRate.isLessThanOrEqualTo(this.lowerBoundRate) ||
      packetLowerBoundRate.isGreaterThanOrEqualTo(this.upperBoundRate)
    if (shouldResetExchangeRate) {
      log.debug(
        'exchange rate changed. resetting to [%s, %s]',
        packetLowerBoundRate,
        packetUpperBoundRate
      )
      this.upperBoundRate = packetUpperBoundRate
      this.lowerBoundRate = packetLowerBoundRate
      this.sentAmounts.clear()
      this.receivedAmounts.clear()
    }

    if (packetLowerBoundRate.isGreaterThan(this.lowerBoundRate)) {
      log.debug(
        'increasing probed rate lower bound from %s to %s',
        this.lowerBoundRate,
        packetLowerBoundRate
      )
      this.lowerBoundRate = packetLowerBoundRate
    }

    if (packetUpperBoundRate.isLessThan(this.upperBoundRate)) {
      log.debug(
        'reducing probed rate upper bound from %s to %s',
        this.upperBoundRate,
        packetUpperBoundRate
      )
      this.upperBoundRate = packetUpperBoundRate
    }

    this.sentAmounts.set(receivedAmount.value, sourceAmount)
    this.receivedAmounts.set(sourceAmount.value, receivedAmount)
  }

  /**
   * Estimate the delivered amount from the given source amount.
   * (1) Low-end estimate: at least this amount will get delivered, if the rate hasn't fluctuated.
   * (2) High-end estimate: no more than this amount will get delivered, if the rate hasn't fluctuated.
   *
   * Cap the destination amounts at the max U64, since that's the most that an ILP packet can credit.
   */
  estimateDestinationAmount(sourceAmount: Int): [Int, Int] {
    // If we already sent a packet for this amount, return how much the recipient got
    const amountReceived = this.receivedAmounts.get(sourceAmount.value)
    if (amountReceived) {
      return [amountReceived, amountReceived]
    }

    const lowEndDestination = sourceAmount.multiplyFloor(this.lowerBoundRate).orLesser(Int.MAX_U64)

    // Since upper bound exchange rate is exclusive:
    // If source amount converts exactly to an integer, destination amount MUST be 1 unit less
    // If source amount doesn't convert precisely, we can't narrow it any better than that amount, floored ¯\_(ツ)_/¯
    const highEndDestination = sourceAmount
      .multiplyCeil(this.upperBoundRate)
      .subtract(Int.ONE)
      .orLesser(Int.MAX_U64)

    return [lowEndDestination, highEndDestination]
  }

  /**
   * Estimate the source amount that delivers the given destination amount.
   * (1) Low-end estimate (may under-deliver, won't over-deliver): lowest source amount
   *     that *may* deliver the given destination amount, if the rate hasn't fluctuated.
   * (2) High-end estimate (won't under-deliver, may over-deliver): lowest source amount that
   *     delivers at least the given destination amount, if the rate hasn't fluctuated.
   *
   * Returns `undefined` if the rate is 0 and it may not be possible to deliver anything.
   */
  estimateSourceAmount(destinationAmount: PositiveInt): [PositiveInt, PositiveInt] | undefined {
    // If this amount was received in a previous packet, return the source amount of that packet
    const amountSent = this.sentAmounts.get(destinationAmount.value)
    if (amountSent) {
      return [amountSent, amountSent]
    }

    const lowerBoundRate = this.lowerBoundRate.reciprocal()
    const upperBoundRate = this.upperBoundRate.reciprocal()

    // If the exchange rate is a packet that delivered 0, the source amount is undefined
    if (!lowerBoundRate || !upperBoundRate) {
      return
    }

    const lowEndSource = destinationAmount.multiplyFloor(upperBoundRate).add(Int.ONE)
    const highEndSource = destinationAmount.multiplyCeil(lowerBoundRate)
    return [lowEndSource, highEndSource]
  }
}

/** Compute the realized exchange rate from STREAM replies */
export class ExchangeRateController implements StreamController {
  private state?: ExchangeRateCalculator

  getRateCalculator(): ExchangeRateCalculator | undefined {
    return this.state
  }

  applyRequest({ sourceAmount, log }: StreamRequest): (reply: StreamReply) => void {
    return ({ destinationAmount }: StreamReply) => {
      // Discard 0 amount packets
      if (!sourceAmount.isPositive()) {
        return
      }

      // Only track the rate for authentic STREAM replies
      if (!destinationAmount) {
        return
      }

      if (!this.state) {
        // Once we establish a rate, from that point on, a rate is always known
        this.state = new ExchangeRateCalculator(sourceAmount, destinationAmount, log)
      } else {
        this.state.updateRate(sourceAmount, destinationAmount, log)
      }
    }
  }
}
