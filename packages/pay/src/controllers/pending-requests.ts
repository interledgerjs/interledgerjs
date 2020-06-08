import { StreamController } from '.'
import { PromiseResolver } from '../utils'

/** Wrap all pending requests in Promises to await their completion */
export class PendingRequestTracker implements StreamController {
  private readonly inFlightRequests = new Set<Promise<void>>()

  /** Returns array of in-flight request Promises that resolve when each finishes */
  getPendingRequests(): Promise<void>[] {
    return [...this.inFlightRequests]
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
