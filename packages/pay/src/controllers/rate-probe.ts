import { PaymentError } from '..'
import { SendLoop } from '.'
import { Int, PositiveInt } from '../utils'
import { MaxPacketAmountController } from './max-packet'
import { ExchangeRateController, ExchangeRateCalculator } from './exchange-rate'
import { InFlightTracker } from './pending-requests'
import { RequestBuilder, StreamRequest } from '../request'
import { SequenceController } from './sequence'
import { EstablishmentController } from './establishment'
import { ExpiryController } from './expiry'
import { FailureController } from './failure'
import { AssetDetailsController } from './asset-details'
import { PacingController } from './pacer'

/** Successful rate probe must establish exchange rate bounds and a max packet amount */
export interface RateProbeOutcome {
  maxPacketAmount: PositiveInt
  rateCalculator: ExchangeRateCalculator
}

export class RateProbe extends SendLoop<RateProbeOutcome> {
  private static TIMEOUT_MS = 10000
  private deadline?: number

  // prettier-ignore
  order = [
    SequenceController,        // Log sequence number in subsequent controllers
    EstablishmentController,   // Set destination address for all requests
    ExpiryController  ,        // Set expiry for all requests
    FailureController,         // Fail fast on terminal rejects or connection closes
    MaxPacketAmountController, // Fail fast if max packet amount is 0
    AssetDetailsController,    // Fail fast on destination asset conflicts
    PacingController,          // Limit frequency of requests
    ExchangeRateController,
    InFlightTracker,           // Ensure replies are fully processed before resolving pending requests
  ]

  async trySending(request: StreamRequest): Promise<RateProbeOutcome | PaymentError> {
    const { log } = request

    // TODO Complete when known max packet amount === verified capacity?

    // The rate probe is complete if we know the max packet amount, established a rate, and no in-flight packets
    // (For example, could still be waiting for packets to further narrow the max packet amount)
    const knownMaxPacketAmount = this.controllers
      .get(MaxPacketAmountController)
      .getDiscoveredMaxPacketAmount()
    const rateCalculator = this.controllers.get(ExchangeRateController).getRateCalculator()
    const noPendingRequests =
      this.controllers.get(InFlightTracker).getPendingRequests().length === 0
    if (knownMaxPacketAmount && rateCalculator && noPendingRequests) {
      return {
        maxPacketAmount: knownMaxPacketAmount,
        rateCalculator,
      }
    }

    // Send initial barage of test packets (10^12 ... 10^3)
    // (amounts < 1000 units likely don't offer sufficient precision for quoting)
    if (!this.deadline) {
      this.deadline = Date.now() + RateProbe.TIMEOUT_MS
      for (let i = 10 ** 12; i >= 1000; i / 10) {
        const amount = Int.from(i) as Int
        this.send(new RequestBuilder(request).setSourceAmount(amount).build())
      }
    }

    if (Date.now() > this.deadline) {
      if (rateCalculator) {
        log.error('rate probe failed. did not discover precise max packet amount')
        return PaymentError.RateProbeFailed
      } else {
        log.error('rate probe failed. did not connect to receiver and establish rate')
        return PaymentError.EstablishmentFailed
      }
    }

    // Only available after an initial F08 is encountered, so this is false right after we've sent the initial test packets
    const maxPacketProbeAmount = this.controllers
      .get(MaxPacketAmountController)
      .getNextMaxPacketAmount()
    if (maxPacketProbeAmount) {
      const pendingRequest = this.send(
        new RequestBuilder(request).setSourceAmount(maxPacketProbeAmount).build()
      )
      // Don't try to another request until this request finishes
      return this.run(pendingRequest)
    }

    // Try another after any pending request finishes. Note: even if it exceeds the deadline, it still
    // has to wait for those requests to complete anyways
    const pendingRequests = this.controllers.get(InFlightTracker).getPendingRequests()
    return this.run(Promise.race(pendingRequests))

    // TODO What if there are no current pending requests? Are there cases where this never resolves?
  }
}
