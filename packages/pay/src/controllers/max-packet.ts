import { Reader } from 'oer-utils'
import {
  StreamController,
  StreamReject,
  StreamReply,
  StreamRequest,
  SendState,
  StreamRequestBuilder,
} from './'
import { Int, IlpError, PositiveInt } from '../utils'
import { Logger } from 'ilp-logger'
import { PaymentError } from '..'

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
   * or a probe amount if we're still discovering the precise max packet amount.
   */
  getMaxPacketAmount(): PositiveInt {
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

      case MaxPacketState.UnknownMax:
        return Int.MAX_U64
    }
  }

  /** Have we discovered the precise max packet amount of the path? */
  isPreciseMaxKnown(): boolean {
    return (
      (this.state.type === MaxPacketState.PreciseMax ||
        this.state.type === MaxPacketState.UnknownMax) &&
      this.verifiedPathCapacity.isPositive()
    )
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
      const remoteReceived = Int.fromLong(reader.readUInt64Long())
      const remoteMaximum = Int.fromLong(reader.readUInt64Long())

      log.debug('handling F08. remote received: %s, remote max: %s', remoteReceived, remoteMaximum)

      // F08 is invalid if they received less than their own maximum!
      // This check ensures that remoteReceived is always > 0
      if (!remoteReceived.isGreaterThan(remoteMaximum)) {
        return
      }

      // Exchange rate = remote amount / source amount
      // Local maximum = remote maximum / exchange rate

      // Convert remote max packet amount into source units
      newMax = remoteMaximum.multiply(sourceAmount).divideFloor(remoteReceived)
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
