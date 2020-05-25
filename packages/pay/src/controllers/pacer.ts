import { StreamController, StreamReply, SendState } from '.'

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
  /** UNIX timestamp when most recent packet was sent */
  private lastPacketSentTime = 0

  /** Number of packets currently in flight */
  private numberInFlight = 0

  /** Exponential weighted moving average of the round trip time */
  private averageRoundTrip = DEFAULT_ROUND_TRIP_TIME_MS

  private getPacketFrequency(): number {
    const packetsPerSecondDelay = 1000 / MAX_PACKETS_PER_SECOND
    const maxInFlightDelay = this.averageRoundTrip / MAX_INFLIGHT_PACKETS

    return Math.max(packetsPerSecondDelay, maxInFlightDelay)
  }

  nextState() {
    const exceedsMaxInFlight = this.numberInFlight + 1 > MAX_INFLIGHT_PACKETS
    if (exceedsMaxInFlight) {
      return SendState.Wait
    }

    const delayDuration = this.getPacketFrequency()
    if (this.lastPacketSentTime + delayDuration > Date.now()) {
      return SendState.Wait
    }

    return SendState.Ready
  }

  applyRequest() {
    const sentTime = Date.now()
    this.lastPacketSentTime = sentTime
    this.numberInFlight++

    return (reply: StreamReply) => {
      this.numberInFlight--

      // Only update the RTT if we know the request got to the recipient
      if (reply.isAuthentic()) {
        const roundTripTime = Math.max(Date.now() - sentTime, 0)
        this.averageRoundTrip =
          this.averageRoundTrip * ROUND_TRIP_AVERAGE_WEIGHT +
          roundTripTime * (1 - ROUND_TRIP_AVERAGE_WEIGHT)
      }
    }
  }
}
