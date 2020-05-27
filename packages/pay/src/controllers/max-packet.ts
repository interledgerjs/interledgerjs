import { Reader } from 'oer-utils'
import { StreamController, StreamReject, StreamReply, StreamRequest } from './'
import { toBigNumber, Integer, SAFE_ZERO } from '../utils'
import BigNumber from 'bignumber.js'
import { Errors } from 'ilp-packet'

/** How the maximum packet amount is known or discovered */
enum MaxPacketState {
  /** F08 errors included metadata to communicate the precise max packet amount */
  PreciseMax,
  /**
   * F08 errors isolated an upper max packet amount, but didn't communicate it precisely.
   * Discover the exact max packet amount through probing.
   */
  ImpreciseMax,
  /** No F08 errors have been encountered yet */
  UnknownMax,
}

/** Max packet amount and how it was discovered */
type MaxPacketAmount =
  | {
      type: MaxPacketState.PreciseMax
      /** Precise max packet amount communicated from F08 errors */
      maxPacketAmount: Integer
    }
  | {
      type: MaxPacketState.ImpreciseMax
      /** Max packet amount is known to be less than this, but isn't known precisely */
      maxPacketAmount: Integer
    }
  | {
      type: MaxPacketState.UnknownMax
    }

/** Controller to limit packet amount based on F08 errors */
export class MaxPacketAmountController implements StreamController {
  /** Max packet amount and how it was discovered */
  private state: MaxPacketAmount = {
    type: MaxPacketState.UnknownMax,
  }

  /** Greatest amount the recipient acknowledged to have received */
  private greatestAckAmount = SAFE_ZERO

  /**
   * Return a limit on the amount of the next packet: the precise max packet amount,
   * or a probe amount if we're still discovering the precise max packet amount.
   */
  getMaxPacketAmount(): Integer | undefined {
    switch (this.state.type) {
      case MaxPacketState.PreciseMax:
        return this.state.maxPacketAmount

      // Use a binary search to discover the precise max
      case MaxPacketState.ImpreciseMax:
        return this.state.maxPacketAmount
          .minus(BigNumber.min(this.state.maxPacketAmount, this.greatestAckAmount))
          .dividedBy(2)
          .integerValue(BigNumber.ROUND_CEIL)
          .plus(this.greatestAckAmount) as Integer
    }
  }

  /** Have we discovered the precise max packet amount of the path? */
  isPreciseMaxKnown(): boolean {
    return this.state.type === MaxPacketState.PreciseMax
  }

  applyRequest({ sourceAmount }: StreamRequest) {
    return (reply: StreamReply) => {
      if (reply.isReject() && reply.ilpReject.code === Errors.codes.F08_AMOUNT_TOO_LARGE) {
        this.reduceMaxPacketAmount(reply, sourceAmount)
      } else if (reply.isAuthentic()) {
        this.increasePathCapacity(reply, sourceAmount)
      }
    }
  }

  /** Decrease the path max packet amount in response to F08 errors */
  private reduceMaxPacketAmount({ log, ilpReject }: StreamReject, sourceAmount: Integer) {
    let newMax: Integer
    try {
      const reader = Reader.from(ilpReject.data)
      const remoteReceived = toBigNumber(reader.readUInt64Long())
      const remoteMaximum = toBigNumber(reader.readUInt64Long())

      // F08 is invalid if they received less than their own maximum!
      // This check ensures that remoteReceived is always at least 1
      if (remoteReceived.isLessThanOrEqualTo(remoteMaximum)) {
        return
      }

      // Exchange rate = remote amount / source amount
      // Local maximum = remote maximum / exchange rate

      // Convert max packet amount into source units
      // Per above check, no divide by 0 error since `remoteReceived` cannot be 0
      newMax = remoteMaximum
        .times(sourceAmount)
        .dividedBy(remoteReceived)
        .integerValue(BigNumber.ROUND_DOWN) as Integer

      switch (this.state.type) {
        case MaxPacketState.PreciseMax:
        case MaxPacketState.ImpreciseMax:
          // Only lower the max packet amount
          if (!newMax.isLessThan(this.state.maxPacketAmount)) {
            return
          }

          log.debug(
            'handling F08. reducing max packet amount from %s to %s',
            this.state.maxPacketAmount,
            newMax
          )
          break

        case MaxPacketState.UnknownMax:
          log.debug('handling F08. setting initial max packet to %s', newMax)
      }

      this.state = {
        type: MaxPacketState.PreciseMax,
        maxPacketAmount: newMax,
      }
    } catch (_) {
      // If no metadata was included, the only thing we can infer is that the
      // amount we sent was too high
      const newMax = sourceAmount.minus(1) as Integer

      switch (this.state.type) {
        case MaxPacketState.PreciseMax:
        case MaxPacketState.ImpreciseMax: {
          // Only lower the max packet amount
          if (!newMax.isLessThan(this.state.maxPacketAmount)) {
            return
          }

          log.debug('handling F08 without metadata. reducing max packet amount to %s', newMax)
          break
        }

        case MaxPacketState.UnknownMax:
          log.debug(
            'handling F08 without metadata. setting initial max packet amount to %s',
            newMax
          )
      }

      this.state = {
        type: MaxPacketState.ImpreciseMax,
        maxPacketAmount: newMax,
      }
    }

    // The greatest path packet amount should never be greater than the maximum
    this.greatestAckAmount = BigNumber.min(
      this.greatestAckAmount,
      this.state.maxPacketAmount
    ) as Integer
  }

  /**
   * Increase the greatest amount acknowledged by the recipient, which
   * indicates the path is capable of sending packets of at least that amount
   */
  private increasePathCapacity(reply: StreamReply, sourceAmount: Integer) {
    if (sourceAmount.isGreaterThan(this.greatestAckAmount)) {
      reply.log.debug(
        'increasing greatest path packet amount from %s to %s',
        this.greatestAckAmount,
        sourceAmount
      )
      this.greatestAckAmount = sourceAmount
    }

    if (
      this.state.type === MaxPacketState.ImpreciseMax &&
      this.greatestAckAmount.isEqualTo(this.state.maxPacketAmount)
    ) {
      // Binary search from F08s without metadata is complete: discovered precise max
      reply.log.debug('discovered precise max packet amount: %s', this.state.maxPacketAmount)
      this.state = {
        type: MaxPacketState.PreciseMax,
        maxPacketAmount: this.state.maxPacketAmount,
      }
    }
  }
}
