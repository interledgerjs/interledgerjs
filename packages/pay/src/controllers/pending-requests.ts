import { StreamRequest, StreamController } from '.'

class PromiseResolver {
  public resolve = () => {}
  public readonly promise = new Promise<void>((resolve) => {
    this.resolve = resolve
  })
}

/** Wrap all pending requests in Promises to await their completion */
export class PendingRequestTracker implements StreamController {
  private readonly inFlightPackets: Map<number, PromiseResolver> = new Map()

  /** Returns array of in-flight request Promises that resolve when each finishes */
  getPendingRequests(): Promise<void>[] {
    return [...this.inFlightPackets.values()].map((r) => r.promise)
  }

  applyPrepare({ sequence }: StreamRequest) {
    this.inFlightPackets.set(sequence, new PromiseResolver())
  }

  applyFulfill({ sequence }: StreamRequest) {
    this.completeRequest(sequence)
  }

  applyReject({ sequence }: StreamRequest) {
    this.completeRequest(sequence)
  }

  private completeRequest(sequence: number) {
    this.inFlightPackets.get(sequence)?.resolve()
    this.inFlightPackets.delete(sequence)
  }
}
