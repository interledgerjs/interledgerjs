import { StreamController } from '.'
import { PromiseResolver } from '../utils'
import { StreamRequest } from '../request'

/** Wrap all pending requests in Promises to await their completion */
export class InFlightTracker implements StreamController {
  /** Maximum number of packets to have in-flight, yet to receive a Fulfill or Reject */
  static MAX_INFLIGHT_PACKETS = 20

  /** Set of all in-flight requests, with promises that resolve after their side effects are applied */
  private readonly inFlightRequests = new Set<Promise<void>>()

  /** Returns array of in-flight request Promises that resolve when each finishes */
  getPendingRequests(): Promise<void>[] {
    return [...this.inFlightRequests]
  }

  nextState(request: StreamRequest): StreamRequest | Promise<void> {
    const exceedsMaxInFlight = this.inFlightRequests.size >= InFlightTracker.MAX_INFLIGHT_PACKETS
    return exceedsMaxInFlight ? Promise.race(this.getPendingRequests()) : request
  }

  applyRequest(): () => void {
    const { resolve, promise } = new PromiseResolver<void>()
    this.inFlightRequests.add(promise)

    return () => {
      resolve()
      this.inFlightRequests.delete(promise)
    }
  }
}
