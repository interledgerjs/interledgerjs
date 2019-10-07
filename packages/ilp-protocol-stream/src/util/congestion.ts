import * as Long from 'long'
import createLogger from 'ilp-logger'
import * as IlpPacket from 'ilp-packet'
import { Reader } from 'oer-utils'
import {
  checkedAdd,
  checkedMultiply,
  maxLong,
  minLong,
  multiplyDivideFloor
} from './long'

const log = createLogger('ilp-protocol-stream:Congestion')

interface CongestionOptions {
  /** Maximum amount per packet, even if F08 reports larger */
  maximumPacketAmount?: Long
}

export class CongestionController {
  /** Used to probe for the Maximum Packet Amount if the connectors don't tell us directly */
  private _testMaximumPacketAmount: Long
  /** The path's Maximum Packet Amount, discovered through F08 errors */
  private _maximumPacketAmount: Long
  /** The sender-chosen maximum packet amount. */
  private _fixedPacketAmount: Long

  constructor (opts: CongestionOptions) {
    this._testMaximumPacketAmount = Long.MAX_UNSIGNED_VALUE
    this._maximumPacketAmount = Long.MAX_UNSIGNED_VALUE
    this._fixedPacketAmount = opts.maximumPacketAmount || Long.MAX_UNSIGNED_VALUE
  }

  get testMaximumPacketAmount (): Long {
    return this._testMaximumPacketAmount
  }

  get maximumPacketAmount (): Long {
    return minLong(this._maximumPacketAmount, this._fixedPacketAmount)
  }

  setMaximumAmounts (amount: Long) {
    this._testMaximumPacketAmount = amount
    this._maximumPacketAmount = amount
  }

  onFulfill (amountSent: Long) {
    const maximumPacketAmount = this.maximumPacketAmount
    const shouldRaiseLimit = amountSent.equals(this._testMaximumPacketAmount)
      && this._testMaximumPacketAmount.lessThan(maximumPacketAmount)
    if (!shouldRaiseLimit) return
    // If we're trying to pinpoint the Maximum Packet Amount, raise
    // the limit because we know that the testMaximumPacketAmount works

    let newTestMax
    const isMaxPacketAmountKnown =
      maximumPacketAmount.notEquals(Long.MAX_UNSIGNED_VALUE)
    if (isMaxPacketAmountKnown) {
      // Take the `max packet amount / 10` and then add it to the last test packet amount for an additive increase.
      const additiveIncrease = maximumPacketAmount.divide(10)
      newTestMax = minLong(
        checkedAdd(this._testMaximumPacketAmount, additiveIncrease).sum,
        maximumPacketAmount)
      log.trace('last packet amount was successful (max packet amount: %s), raising packet amount from %s to: %s', maximumPacketAmount, this._testMaximumPacketAmount, newTestMax)
    } else {
      // Increase by 2 times in this case since we do not know the max packet amount
      newTestMax = checkedMultiply(
        this._testMaximumPacketAmount,
        Long.fromNumber(2, true)).product
      log.trace('last packet amount was successful, unknown max packet amount, raising packet amount from: %s to: %s', this._testMaximumPacketAmount, newTestMax)
    }
    this._testMaximumPacketAmount = newTestMax
  }

  // Returns the new maximum packet amount.
  onAmountTooLargeError (reject: IlpPacket.IlpReject, amountSent: Long): Long {
    let receivedAmount: Long | undefined
    let maximumAmount: Long | undefined
    try {
      const reader = Reader.from(reject.data)
      receivedAmount = reader.readUInt64Long()
      maximumAmount = reader.readUInt64Long()
    } catch (err) {
      receivedAmount = undefined
      maximumAmount = undefined
    }

    if (receivedAmount && maximumAmount && receivedAmount.greaterThan(maximumAmount)) {
      const newMaximum = multiplyDivideFloor(amountSent, maximumAmount, receivedAmount)
      log.trace('reducing maximum packet amount from %s to %s', this._maximumPacketAmount, newMaximum)
      this._maximumPacketAmount = newMaximum
      this._testMaximumPacketAmount = newMaximum
    } else {
      // Connector didn't include amounts
      this._maximumPacketAmount = amountSent.subtract(1)
      this._testMaximumPacketAmount = this.maximumPacketAmount.divide(2)
    }
    return this.maximumPacketAmount
  }

  onInsufficientLiquidityError (reject: IlpPacket.IlpReject, amountSent: Long) {
    // TODO add more sophisticated logic for handling bandwidth-related connector errors
    // we should really be keeping track of the amount sent within a given window of time
    // and figuring out the max amount per window. this logic is just a stand in to fix
    // infinite retries when it runs into this type of error
    const minPacketAmount = minLong(amountSent, this._testMaximumPacketAmount)
    const newTestAmount = minPacketAmount.subtract(minPacketAmount.divide(3))
    // don't let it go to zero, set to 2 so that the other side gets at least 1 after the exchange rate is taken into account
    this._testMaximumPacketAmount = maxLong(Long.fromNumber(2, true), newTestAmount)
    log.warn('got T04: Insufficient Liquidity error triggered by: %s reducing the packet amount to %s', reject.triggeredBy, this._testMaximumPacketAmount)
  }
}
