import { Reader } from 'oer-utils'
import {
  StreamController,
  StreamReject,
  StreamReply,
  StreamRequest,
  SendState,
  StreamRequestBuilder,
} from './'
import { Int, PositiveInt, Ratio } from '../utils'
import { Logger } from 'ilp-logger'
import { PaymentError } from '..'
import { IlpError } from 'ilp-packet'

/** How the maximum packet amount is known or discovered */
enum MaxPacketState {
  /** Initial state before any F08 errors have been encountered */
  UnknownMax,
  /** F08 errors included metadata to communicate the precise max packet amount */
  PreciseMax,
  /**
   * F08 errors isolated an upper max packet amount, but didn't communicate it precisely.
   * Discover the exact max packet amount through probing.
   */
  ImpreciseMax,
}

/** Max packet amount and how it was discovered */
type MaxPacketAmount =
  | {
      type: MaxPacketState.PreciseMax
      /** Precise max packet amount communicated from F08 errors */
      maxPacketAmount: PositiveInt
    }
  | {
      type: MaxPacketState.ImpreciseMax
      /** Max packet amount is known to be less than this, but isn't known precisely */
      maxPacketAmount: PositiveInt
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

  /**
   * Greatest amount the recipient acknowledged to have received.
   * Note: this is always reduced so it's never greater than the max packet amount
   */
  private verifiedPathCapacity = Int.ZERO

  /** Is the max packet amount 0 and impossible to send value over this path? */
  private noCapacityAvailable = false

  nextState(builder: StreamRequestBuilder): SendState | PaymentError {
    if (this.noCapacityAvailable) {
      builder.sendConnectionClose()
      return PaymentError.ConnectorError
    }

    return SendState.Ready
  }

  /**
   * Return a limit on the amount of the next packet: the precise max packet amount,
   * or a probe amount if the precise max packet amount is yet to be discovered.
   */
  getNextMaxPacketAmount(): PositiveInt | undefined {
    switch (this.state.type) {
      case MaxPacketState.PreciseMax:
        return this.state.maxPacketAmount

      // Use a binary search to discover the precise max
      case MaxPacketState.ImpreciseMax:
        // Always positive: if verifiedCapacity=0, maxPacketAmount / 2
        // must round up to 1, or if verifiedCapacity=maxPacketAmount,
        // verifiedCapacity is positive, so adding it will always be positive
        return this.state.maxPacketAmount
          .subtract(this.verifiedPathCapacity)
          .divideCeil(Int.TWO)
          .add(this.verifiedPathCapacity) as PositiveInt
    }
  }

  /**
   * Return a known limit on the max packet amount of the path, if it has
   * been discovered. Requires that at least 1 unit has been acknowledged by
   * the receiver, and either, the max packet amount has been precisely discovered,
   * or no F08 has been encountered yet.
   */
  getDiscoveredMaxPacketAmount(): PositiveInt | undefined {
    if (this.verifiedPathCapacity.isPositive()) {
      if (this.state.type === MaxPacketState.PreciseMax) {
        return this.state.maxPacketAmount
      } else if (this.state.type === MaxPacketState.UnknownMax) {
        return Int.MAX_U64
      }
    }
  }

  applyRequest({ sourceAmount }: StreamRequest) {
    return (reply: StreamReply): void => {
      if (reply.isReject() && reply.ilpReject.code === IlpError.F08_AMOUNT_TOO_LARGE) {
        this.reduceMaxPacketAmount(reply, sourceAmount)
      } else if (reply.isAuthentic()) {
        this.adjustPathCapacity(reply.log, sourceAmount)
      }
    }
  }

  /** Decrease the path max packet amount in response to F08 errors */
  private reduceMaxPacketAmount({ log, ilpReject }: StreamReject, sourceAmount: Int) {
    let newMax: Int
    let isPreciseMax: boolean
    try {
      const reader = Reader.from(ilpReject.data)
      const remoteReceived = Int.from(reader.readUInt64Long())
      const remoteMaximum = Int.from(reader.readUInt64Long())

      log.debug('handling F08. remote received: %s, remote max: %s', remoteReceived, remoteMaximum)

      // F08 is invalid if they received less than their own maximum!
      // This check ensures that remoteReceived is always > 0
      if (!remoteReceived.isGreaterThan(remoteMaximum)) {
        return
      }

      // Convert remote max packet amount into source units
      const exchangeRate = new Ratio(sourceAmount, remoteReceived)
      newMax = remoteMaximum.multiplyFloor(exchangeRate) // newMax <= source amount since remoteMaximum / remoteReceived is < 1
      isPreciseMax = true
    } catch (_) {
      // If no metadata was included, the only thing we can infer is that the amount we sent was too high
      log.debug('handling F08 without metadata. source amount: %s', sourceAmount)
      newMax = sourceAmount.subtract(Int.ONE)
      isPreciseMax = false
    }

    // Special case if max packet is 0 or rounds to 0
    if (!newMax.isPositive()) {
      log.debug('ending payment: max packet amount is 0, cannot send over path')
      this.noCapacityAvailable = true
      return
    }

    if (this.state.type === MaxPacketState.UnknownMax) {
      log.debug('setting initial max packet amount to %s', newMax)
    } else if (newMax.isLessThan(this.state.maxPacketAmount)) {
      log.debug('reducing max packet amount from %s to %s', this.state.maxPacketAmount, newMax)
    } else {
      return // Ignore F08s that don't lower the max packet amount
    }

    this.state = {
      type: isPreciseMax ? MaxPacketState.PreciseMax : MaxPacketState.ImpreciseMax,
      maxPacketAmount: newMax,
    }

    this.adjustPathCapacity(log, this.verifiedPathCapacity)
  }

  /**
   * Increase the greatest amount acknowledged by the recipient, which
   * indicates the path is capable of sending packets of at least that amount
   */
  private adjustPathCapacity(log: Logger, ackAmount: Int) {
    const maxPacketAmount =
      this.state.type === MaxPacketState.UnknownMax ? Int.MAX_U64 : this.state.maxPacketAmount

    const newPathCapacity = this.verifiedPathCapacity.orGreater(ackAmount).orLesser(maxPacketAmount)
    if (newPathCapacity.isGreaterThan(this.verifiedPathCapacity)) {
      log.debug(
        'increasing greatest path packet amount from %s to %s',
        this.verifiedPathCapacity,
        newPathCapacity
      )
    }

    this.verifiedPathCapacity = newPathCapacity

    if (
      this.state.type === MaxPacketState.ImpreciseMax &&
      this.verifiedPathCapacity.isEqualTo(this.state.maxPacketAmount)
    ) {
      // Binary search from F08s without metadata is complete: discovered precise max
      log.debug('discovered precise max packet amount: %s', this.state.maxPacketAmount)
      this.state = {
        type: MaxPacketState.PreciseMax,
        maxPacketAmount: this.state.maxPacketAmount,
      }
    }
  }
}
