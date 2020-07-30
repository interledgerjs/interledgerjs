import { StreamController, StreamReply, NextRequest, ControllerMap } from '.'
import { IlpError } from 'ilp-packet'
import { sleep } from '../utils'
import { PendingRequestTracker } from './pending-requests'

/**
 * Flow controller to send packets at a consistent cadence
 * and prevent sending more packets than the network can handle
 */
export class PacingController implements StreamController {
  /** Maximum number of packets to have in-flight, yet to receive a Fulfill or Reject */
  private static MAX_INFLIGHT_PACKETS = 20

  /** Initial number of packets to send in 1 second interval (25ms delay between packets) */
  private static DEFAULT_PACKETS_PER_SECOND = 40

  /** Always try to send at least 1 packet in 1 second (unless RTT is very high) */
  private static MIN_PACKETS_PER_SECOND = 1

  /** Maximum number of packets to send in a 1 second interval, after ramp up (5ms delay) */
  private static MAX_PACKETS_PER_SECOND = 200

  /** RTT to use for pacing before an average can be ascertained */
  private static DEFAULT_ROUND_TRIP_TIME_MS = 200

  /** Weight to compute next RTT average. Halves weight of past round trips every ~5 flights */
  private static ROUND_TRIP_AVERAGE_WEIGHT = 0.9

  /** UNIX timestamp when most recent packet was sent */
  private lastPacketSentTime = 0

  /** Number of packets currently in flight */
  private numberInFlight = 0

  /** Exponential weighted moving average of the round trip time */
  private averageRoundTrip = PacingController.DEFAULT_ROUND_TRIP_TIME_MS

  /** Rate of packets to send per second. This shouldn't ever be 0, but may become a small fraction */
  private packetsPerSecond = PacingController.DEFAULT_PACKETS_PER_SECOND

  /**
   * Rate to send packets, in packets / millisecond, using packet rate limit and round trip time.
   * Corresponds to the ms delay between each packet
   */
  getPacketFrequency(): number {
    const packetsPerSecondDelay = 1000 / this.packetsPerSecond
    const maxInFlightDelay = this.averageRoundTrip / PacingController.MAX_INFLIGHT_PACKETS

    return Math.max(packetsPerSecondDelay, maxInFlightDelay)
  }

  /** Earliest UNIX timestamp when the pacer will allow the next packet to be sent */
  getNextPacketSendTime(): number {
    const delayDuration = this.getPacketFrequency()
    return this.lastPacketSentTime + delayDuration
  }

  nextState(_: NextRequest, controllers: ControllerMap): Promise<unknown> | void {
    const exceedsMaxInFlight = this.numberInFlight + 1 > PacingController.MAX_INFLIGHT_PACKETS
    if (exceedsMaxInFlight) {
      const pendingRequests = controllers.get(PendingRequestTracker).getPendingRequests()
      return Promise.race(pendingRequests)
    }

    const durationUntilNextPacket = this.getNextPacketSendTime() - Date.now()
    if (durationUntilNextPacket > 0) {
      return sleep(durationUntilNextPacket)
    }
  }

  applyRequest(): (reply: StreamReply) => void {
    const sentTime = Date.now()
    this.lastPacketSentTime = sentTime
    this.numberInFlight++

    return (reply: StreamReply) => {
      this.numberInFlight--

      // Only update the RTT if we know the request got to the recipient
      if (reply.isAuthentic()) {
        const roundTripTime = Math.max(Date.now() - sentTime, 0)
        this.averageRoundTrip =
          this.averageRoundTrip * PacingController.ROUND_TRIP_AVERAGE_WEIGHT +
          roundTripTime * (1 - PacingController.ROUND_TRIP_AVERAGE_WEIGHT)
      }

      // If we encounter a temporary error that's not related to liquidity,
      // exponentially backoff the rate of packet sending
      if (
        reply.isReject() &&
        reply.ilpReject.code[0] === 'T' && // TODO add this back
        reply.ilpReject.code !== IlpError.T04_INSUFFICIENT_LIQUIDITY
      ) {
        const reducedRate = Math.max(
          PacingController.MIN_PACKETS_PER_SECOND,
          this.packetsPerSecond / 2 // Fractional rates are fine
        )
        reply.log.debug(
          'handling %s. backing off to %s packets / second',
          reply.ilpReject.code,
          reducedRate.toFixed(3)
        )
        this.packetsPerSecond = reducedRate
      }
      // If the packet got through, additive increase of sending rate, up to some maximum
      else if (reply.isAuthentic()) {
        this.packetsPerSecond = Math.min(
          PacingController.MAX_PACKETS_PER_SECOND,
          this.packetsPerSecond + 0.5
        )
      }
    }
  }
}
