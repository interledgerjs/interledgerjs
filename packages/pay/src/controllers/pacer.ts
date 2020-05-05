import { StreamController, StreamReply, StreamRequest, isAuthentic, SendState } from '.'

/** Maximum number of packets to send at one time before a Fulfill or Reject is received */
const MAX_INFLIGHT_PACKETS = 20

/**
 * Maximum number of packets to send in 1 second interval, corresponding
 * to a minimum 25ms delay between sending packets
 */
const MAX_PACKETS_PER_SECOND = 40

/**
 * Estimated round trip to use for pacing before an average RTT
 * can be ascertained
 */
const DEFAULT_ROUND_TRIP_TIME_MS = 200

/**
 * Weight to apply to existing weighted average when computing the next value.
 * The weight of previous round trips will be halved each ~5 flights
 */
const ROUND_TRIP_AVERAGE_WEIGHT = 0.9

/**
 * Flow controller to send packets at a consistent cadence
 * and prevent sending too many packets
 */
export class PacingController implements StreamController {
  /** Mapping of sequence number -> UNIX timestamp when the packet was sent */
  private readonly inFlightPackets: Map<number, number> = new Map()

  /** Exponential weighted moving average of the round trip time */
  public averageRoundTrip = DEFAULT_ROUND_TRIP_TIME_MS

  public getMaxNumberInFlightPackets(): number {
    return MAX_INFLIGHT_PACKETS
  }

  public getPacketFrequency(): number {
    const packetsPerSecondDelay = 1000 / MAX_PACKETS_PER_SECOND
    const maxInFlightDelay = this.averageRoundTrip / MAX_INFLIGHT_PACKETS

    return Math.max(packetsPerSecondDelay, maxInFlightDelay)
  }

  nextState() {
    const exceedsMaxInFlight = this.inFlightPackets.size + 1 > MAX_INFLIGHT_PACKETS
    if (exceedsMaxInFlight) {
      return SendState.Wait
    }

    const delayDuration = this.getPacketFrequency()
    const lastPacketSentTime = Math.max(...this.inFlightPackets.values())
    if (lastPacketSentTime + delayDuration > Date.now()) {
      return SendState.Wait
    }

    return SendState.Ready
  }

  applyPrepare({ sequence }: StreamRequest) {
    this.inFlightPackets.set(sequence, Date.now())
  }

  applyFulfill(reply: StreamReply) {
    this.updateAverageRoundTripTime(reply)
  }

  applyReject(reply: StreamReply) {
    this.updateAverageRoundTripTime(reply)
    // TODO Back-off in time on T05 errors? Or other errors, e.g. T00?
  }

  private updateAverageRoundTripTime(reply: StreamReply) {
    // Only update the RTT if we know the request got to the recipient
    if (isAuthentic(reply)) {
      const startTime = this.inFlightPackets.get(reply.sequence)
      if (startTime) {
        const roundTripTime = Math.max(Date.now() - startTime, 0)
        this.averageRoundTrip =
          this.averageRoundTrip * ROUND_TRIP_AVERAGE_WEIGHT +
          roundTripTime * (1 - ROUND_TRIP_AVERAGE_WEIGHT)
      }
    }

    this.inFlightPackets.delete(reply.sequence)
  }
}
