import EventEmitter3 = require('eventemitter3')
import * as Debug from 'debug'
import BigNumber from 'bignumber.js'

export interface MoneyStreamOpts {
  id: number,
  isServer: boolean
}

export class MoneyStream extends EventEmitter3 {
  protected id: number
  protected debug: Debug.IDebugger
  protected isServer: boolean

  protected _amountIncoming: BigNumber
  protected _amountOutgoing: BigNumber
  protected closed: boolean

  constructor (opts: MoneyStreamOpts) {
    super()
    this.id = opts.id
    this.isServer = opts.isServer
    this.debug = Debug(`ilp-protocol-stream:Stream:${this.id}:${this.isServer ? 'Server' : 'Client'}`)

    this._amountIncoming = new BigNumber(0)
    this._amountOutgoing = new BigNumber(0)
    this.closed = false
  }

  get amountIncoming (): BigNumber {
    return new BigNumber(this._amountIncoming)
  }

  get amountOutgoing (): BigNumber {
    return new BigNumber(this._amountOutgoing)
  }

  close (): void {
    this.emit('close')
    this.closed = true
  }

  isClosed (): boolean {
    return this.closed
  }

  /**
   * Add money to the stream
   *
   * @param amount Amount to send
   */
  send (amount: BigNumber.Value): void {
    if (this.closed) {
      throw new Error('Stream already closed')
    }

    this._amountOutgoing = this._amountOutgoing.plus(amount)
    this.debug(`send: ${amount} (amountOutgoing: ${this._amountOutgoing})`)
    this.emit('_send')
  }

  /**
   * Take money out of the stream
   *
   * @param amount Amount to receive. If unspecified, it will return the full amount available
   */
  receive (amount?: BigNumber.Value): BigNumber {
    const amountToReceive = new BigNumber(amount || this._amountIncoming)

    // The user can call receive to pull money out of the stream that they previously sent,
    // in addition to money they've received from the other party
    const amountAvailable = this._amountIncoming.plus(this._amountOutgoing)
    if (amountToReceive.isGreaterThan(amountAvailable)) {
      throw new Error(`Cannot receive ${amount}, only ${amountAvailable} available`)
    }

    this._amountIncoming = this._amountIncoming.minus(amountToReceive)
    if (this._amountIncoming.isNegative()) {
      this._amountOutgoing = this._amountOutgoing.plus(this._amountIncoming)
      this._amountIncoming = new BigNumber(0)
    }

    this.debug(`receive: ${amountToReceive} (amountIncoming: ${this._amountIncoming}, amountOutgoing: ${this._amountOutgoing})`)

    return amountToReceive
  }

  /**
   * (Internal) Add money to the stream (from an external source)
   * @private
   */
  _addToIncoming (amount: BigNumber): void {
    this._amountIncoming = this._amountIncoming.plus(amount)
    this.debug(`added money to stream from external source: ${amount} (amountIncoming: ${this._amountIncoming})`)
    this.emit('incoming', amount.toString())
  }

  /**
   * (Internal) Take money out of the stream (to send to an external destination)
   * @private
   */
  _takeFromOutgoing (maxAmount?: BigNumber): BigNumber {
    const amountToReceive = (maxAmount === undefined ? this._amountOutgoing : BigNumber.minimum(maxAmount, this._amountOutgoing))
    this._amountOutgoing = this._amountOutgoing.minus(amountToReceive)
    this.emit(`sending money from stream to external destination: ${amountToReceive} (amountOutgoing: ${this._amountOutgoing})`)
    this.emit('outgoing', amountToReceive.toString())
    return amountToReceive
  }
}
