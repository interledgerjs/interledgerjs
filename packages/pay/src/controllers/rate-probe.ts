import { PaymentError } from '..'
import { StreamSender, SendState, GetController } from '.'
import { Int, PositiveInt } from '../utils'
import { MaxPacketAmountController } from './max-packet'
import { ExchangeRateController, ExchangeRateCalculator } from './exchange-rate'
import { SequenceController } from './sequence'
import { EstablishmentController } from './establishment'
import { ExpiryController } from './expiry'
import { FailureController } from './failure'
import { AssetDetailsController } from './asset-details'
import { PacingController } from './pacer'
import { RequestBuilder } from '../request'

export interface ProbeResult {
  maxPacketAmount: PositiveInt
  rateCalculator: ExchangeRateCalculator
  packetFrequency: number
}

/** Establish exchange rate bounds and path max packet amount capacity with test packets */
export class RateProbe implements StreamSender<ProbeResult> {
  /** Duration in milliseconds before the rate probe fails */
  private static TIMEOUT = 10_000

  /** Largest test packet amount */
  static MAX_PROBE_AMOUNT = Int.from(1_000_000_000_000) as PositiveInt

  /**
   * Initial barage of test packets amounts left to send (10^12 ... 10^3).
   * Amounts < 1000 units are less likely to offer sufficient precision for quoting
   */
  private readonly remainingTestAmounts = [
    Int.ZERO, // Shares limits & ensures connection is established, in case no asset probe
    Int.from(10 ** 12),
    Int.from(10 ** 11),
    Int.from(10 ** 10),
    Int.from(10 ** 9),
    Int.from(10 ** 8),
    Int.from(10 ** 7),
    Int.from(10 ** 6),
    Int.from(10 ** 5),
    Int.from(10 ** 4),
    Int.from(10 ** 3),
  ] as Int[]

  /**
   * Amounts of all in-flight packets from subsequent (non-initial) probe packets,
   * to ensure the same amount isn't sent continuously
   */
  private readonly inFlightAmounts = new Set<string>()

  /** UNIX timestamp when the rate probe fails */
  private deadline?: number

  // prettier-ignore
  readonly order = [
    SequenceController,        // Log sequence number in subsequent controllers
    EstablishmentController,   // Set destination address for all requests
    ExpiryController,          // Set expiry for all requests
    FailureController,         // Fail fast on terminal rejects or connection closes
    MaxPacketAmountController, // Fail fast if max packet amount is 0
    AssetDetailsController,    // Fail fast on destination asset conflicts
    PacingController,          // Limit frequency of requests
    ExchangeRateController,
  ]

  nextState(request: RequestBuilder, lookup: GetController): SendState<ProbeResult> {
    if (!this.deadline) {
      this.deadline = Date.now() + RateProbe.TIMEOUT
    } else if (Date.now() > this.deadline) {
      request.log.error('rate probe failed. did not establish rate and/or path capacity')
      return SendState.Error(PaymentError.RateProbeFailed)
    }

    const probeAmount = this.remainingTestAmounts.shift()
    if (probeAmount && !this.inFlightAmounts.has(probeAmount.toString())) {
      // Send and commit the test packet
      request.setSourceAmount(probeAmount)
      this.inFlightAmounts.add(probeAmount.toString())

      return SendState.Send(() => {
        this.inFlightAmounts.delete(probeAmount.toString())

        // If we further narrowed the max packet amount, use that amount next.
        // Otherwise, no max packet limit is known, so retry this amount.
        const nextProbeAmount =
          lookup(MaxPacketAmountController).getNextMaxPacketAmount() ?? probeAmount
        if (!this.remainingTestAmounts.some((n) => n.isEqualTo(nextProbeAmount))) {
          this.remainingTestAmounts.push(nextProbeAmount)
        }

        // Resolve rate probe if known rate and verified path capacity
        const rateCalculator = lookup(ExchangeRateController).getRateCalculator()
        return rateCalculator && lookup(MaxPacketAmountController).isProbeComplete()
          ? SendState.Done({
              rateCalculator,
              packetFrequency: lookup(PacingController).getPacketFrequency(),
              maxPacketAmount: lookup(MaxPacketAmountController).getMaxPacketAmountLimit(),
            })
          : SendState.Schedule() // Try sending another probing packet to narrow max packet amount
      })
    }

    return SendState.Yield()
  }
}
