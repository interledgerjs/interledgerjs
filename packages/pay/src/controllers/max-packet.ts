import { Reader } from 'oer-utils'
import { StreamController, StreamReject, StreamRequest } from './'
import { toBigNumber, Integer } from '../utils'
import BigNumber from 'bignumber.js'
import { Maybe } from 'true-myth'

/**
 * TODO Changes from `ilp-protocol-stream`
 * 1. Instead of doubling an unknown max packet amount on fulfill
 *    (which may trigger an F08 again!), this uses a binary search to
 *    precisely determine the unknown max packet amount.
 * 2. Also, the liquidity congestion controller logic is now separate
 *    from the F08/path max packet amount logic.
 * 3. More precisely defined state machine
 */

/** How the maximum packet amount is known or discovered */
enum MaxPacketState {
  /** F08 errors communicated the precise max packet amount */
  PreciseMax,
  /**
   * F08 errors limited the max packet amount, but didn't communicate the precise amount.
   * Discover the exact max packet amount through probing.
   */
  DiscoveredMax,
  /** No F08 errors have been encountered yet */
  UnknownMax
}

/** Max packet amount state and how it was discovered */
type MaxPacketAmount =
  | {
      type: MaxPacketState.PreciseMax
      /** Precise max packet amount communicated from F08 errors */
      maxPacketAmount: Integer
    }
  | {
      type: MaxPacketState.DiscoveredMax
      /** Discovered max packet amount from F08 errors */
      maxPacketAmount: Integer
      /** Packet amount to probe the maximum since connectors haven't told us directly */
      probeAmount: Integer
    }
  | {
      type: MaxPacketState.UnknownMax
    }

/** Controller to limit packet amount based on F08 errors */
export class MaxPacketAmountController implements StreamController {
  private state: MaxPacketAmount = {
    type: MaxPacketState.UnknownMax
  }

  // TODO If not provided a precise max packet amount/using a probe amount,
  //      this may screw up logic in AmountStrategy that estimates the number of remaining packets

  /**
   * Return the max packet amount per F08 errors, or `Nothing` if it's unknown.
   * Note: this amount can be 0
   */
  public getMaxPacketAmount(): Maybe<Integer> {
    switch (this.state.type) {
      case MaxPacketState.PreciseMax:
        return Maybe.just(this.state.maxPacketAmount)

      case MaxPacketState.DiscoveredMax:
        return Maybe.just(this.state.probeAmount)

      case MaxPacketState.UnknownMax:
        return Maybe.nothing()
    }
  }

  applyFulfill({ sourceAmount, log }: StreamRequest) {
    // If max packet amount is unknown, discover it using a binary search
    if (this.state.type === MaxPacketState.DiscoveredMax) {
      const { probeAmount, maxPacketAmount } = this.state

      // Increase probe amount by half the difference between the known max packet amount and *this packet amount*
      const increment = maxPacketAmount
        .minus(sourceAmount)
        .dividedBy(2)
        .integerValue(BigNumber.ROUND_DOWN) as Integer // TODO No cast
      const newProbeAmount = probeAmount.plus(increment) as Integer // TODO No cast

      // Ensure the new probe amount is within the range (probeAmount, maxPacketAmount)
      if (
        !newProbeAmount.isGreaterThan(probeAmount) ||
        !newProbeAmount.isLessThan(maxPacketAmount)
      ) {
        return
      }

      log.debug(
        'unknown max packet amount, increasing probe amount from %s to %s',
        probeAmount,
        newProbeAmount
      )
      this.state.probeAmount = newProbeAmount
    }
  }

  applyReject({ sourceAmount, reject, log }: StreamReject) {
    if (reject.code !== 'F08') {
      return
    }

    try {
      const reader = Reader.from(reject.data)
      const remoteReceived = toBigNumber(reader.readUInt64Long())
      const remoteMaximum = toBigNumber(reader.readUInt64Long())

      // F08 is invalid if they received less than their own maximum...
      if (remoteReceived.isLessThanOrEqualTo(remoteMaximum)) {
        return
      }

      const newMax = sourceAmount
        .times(remoteMaximum)
        .dividedBy(remoteReceived)
        .integerValue(BigNumber.ROUND_CEIL) as Integer // TODO No cast

      switch (this.state.type) {
        case MaxPacketState.PreciseMax:
        case MaxPacketState.DiscoveredMax:
          // Only lower the max packet amount
          if (!newMax.isLessThan(this.state.maxPacketAmount)) {
            return
          }

          log.debug(
            'handling F08. reducing max packet amount from %s to %s',
            this.state.maxPacketAmount,
            newMax
          )
          this.state = {
            type: MaxPacketState.PreciseMax,
            maxPacketAmount: newMax
          }
          break

        case MaxPacketState.UnknownMax:
          log.debug('handling F08. setting initial max packet amount to %s', newMax)
          this.state = {
            type: MaxPacketState.PreciseMax,
            maxPacketAmount: newMax
          }
      }
    } catch (err) {
      // No precise max packet amount was communicated, but set a new
      // ceiling and halve the amount used to probe it
      const newMax = sourceAmount.minus(1) as Integer // TODO No cast
      const probeAmount = newMax.dividedBy(2).integerValue(BigNumber.ROUND_DOWN) as Integer // TODO No cast

      switch (this.state.type) {
        case MaxPacketState.PreciseMax:
        case MaxPacketState.DiscoveredMax:
          // Only lower the max packet packet amount
          if (!newMax.isLessThan(this.state.maxPacketAmount)) {
            return
          }

          log.debug(
            'handling F08 without metadata. reducing max packet amount to %s. setting probe amount to %s',
            this.state.maxPacketAmount,
            newMax,
            probeAmount
          )
          this.state = {
            type: MaxPacketState.DiscoveredMax,
            maxPacketAmount: newMax,
            probeAmount
          }
          break

        case MaxPacketState.UnknownMax:
          log.debug(
            'handling F08 without metadata. setting initial max packet amount to %s. setting probe amount to %s',
            newMax,
            probeAmount
          )
          this.state = {
            type: MaxPacketState.DiscoveredMax,
            maxPacketAmount: newMax,
            probeAmount
          }
      }
    }
  }
}
