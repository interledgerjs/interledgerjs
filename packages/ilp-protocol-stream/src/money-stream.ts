import EventEmitter3 = require('eventemitter3')
import * as Debug from 'debug'
import BigNumber from 'bignumber.js'
import 'source-map-support/register'

export interface MoneyStreamOpts {
  id: number,
  isServer: boolean
}

/**
 * Stream for sending money over an ILP STREAM connection.
 */
export class MoneyStream extends EventEmitter3 {
  readonly id: number

  _remoteReceiveMax?: BigNumber
  _remoteReceived?: BigNumber
  _sentEnd: boolean

  protected debug: Debug.IDebugger
  protected isServer: boolean

  protected _totalSent: BigNumber
  protected _totalReceived: BigNumber
  protected _sendMax: BigNumber
  protected _receiveMax: BigNumber
  protected _outgoingHeldAmount: BigNumber

  protected closed: boolean
  protected holds: { [id: string]: BigNumber }

  constructor (opts: MoneyStreamOpts) {
    super()
    this.id = opts.id
    this.isServer = opts.isServer
    this.debug = Debug(`ilp-protocol-stream:${this.isServer ? 'Server' : 'Client'}:MoneyStream:${this.id}`)

    this._totalSent = new BigNumber(0)
    this._totalReceived = new BigNumber(0)
    this._sendMax = new BigNumber(0)
    this._receiveMax = new BigNumber(0)
    this._outgoingHeldAmount = new BigNumber(0)

    this._sentEnd = false
    this.closed = false
    this.holds = {}
  }

  /**
   * Total amount sent so far, denominated in the connection plugin's units.
   */
  get totalSent (): string {
    return this._totalSent.toString()
  }

  /**
   * Total amount received so far, denominated in the connection plugin's units.
   */
  get totalReceived (): string {
    return this._totalReceived.toString()
  }

  /**
   * The current limit up to which the stream will try to send, denominated in the connection plugin's units.
   * (If the `sendMax` is greater than the `totalSent`, the stream will continue to send the difference)
   */
  get sendMax (): string {
    return this._sendMax.toString()
  }

  /**
   * The current limit up to which the stream will try to send, denominated in the connection plugin's units.
   * (If the `receiveMax` is greater than the `totalReceived`, the stream will continue to receive money when the other side sends it)
   */
  get receiveMax (): string {
    return this._receiveMax.toString()
  }

  /**
   * Close the stream and indicate to the other side that it has been closed.
   */
  end (): void {
    if (this.closed) {
      this.debug('tried to close stream that was already closed')
      return
    }
    this.debug('closing stream')
    this.emit('end')
    this.closed = true
    if (!this._sentEnd) {
      this.debug('starting another send loop to tell the peer the stream was closed')
      this.emit('_send')
    }
  }

  /**
   * Returns true if the stream is open for sending and/or receiving.
   */
  isOpen (): boolean {
    return !this.closed
  }

  /**
   * Set the total amount this stream will send, denominated in the connection plugin's units.
   * Note that this is absolute, not relative so calling `setSendMax(100)` twice will only send 100 units.
   */
  setSendMax (limit: BigNumber.Value): void {
    if (this.closed) {
      throw new Error('Stream already closed')
    }
    if (this._totalSent.isGreaterThan(limit)) {
      this.debug(`cannot set sendMax to ${limit} because we have already sent: ${this._totalSent}`)
      throw new Error(`Cannot set sendMax lower than the totalSent`)
    }
    this.debug(`setting sendMax to ${limit}`)
    this._sendMax = new BigNumber(limit)
    this.emit('_send')
  }

  /**
   * Set the total amount this stream will receive, denominated in the connection plugin's units.
   * Note that this is absolute, not relative so calling `setReceiveMax(100)` twice will only let the stream receive 100 units.
   */
  setReceiveMax (limit: BigNumber.Value): void {
    if (this.closed) {
      throw new Error('Stream already closed')
    }
    if (this._totalReceived.isGreaterThan(limit)) {
      this.debug(`cannot set receiveMax to ${limit} because we have already received: ${this._totalReceived}`)
      throw new Error(`Cannot set receiveMax lower than the totalReceived`)
    }
    this.debug(`setting receiveMax to ${limit}`)
    this._receiveMax = new BigNumber(limit)
    this.emit('_send')
  }

  /**
   * Set the total amount the stream will send and wait for that amount to be sent.
   * Note that this is absolute, not relative so calling `sendTotal(100)` twice will only send 100 units.
   *
   * This promise will only resolve when the absolute amount specified is reached, so lowering the `sendMax` may cause this not to resolve.
   */
  async sendTotal (limit: BigNumber.Value): Promise<void> {
    if (this._totalSent.isGreaterThanOrEqualTo(limit)) {
      this.debug(`already sent ${this._totalSent}, not sending any more`)
      return Promise.resolve()
    }

    this.setSendMax(limit)
    await new Promise((resolve, reject) => {
      const self = this
      function outgoingHandler () {
        if (this._totalSent.isGreaterThanOrEqualTo(limit)) {
          cleanup()
          resolve()
        }
      }
      function endHandler () {
        cleanup()
        if ((this._totalSent.isGreaterThanOrEqualTo(limit))) {
          resolve()
        } else {
          this.debug(`Stream was closed before desired amount was sent (target: ${limit}, totalSent: ${this._totalSent})`)
          reject(new Error(`Stream was closed before desired amount was sent (target: ${limit}, totalSent: ${this._totalSent})`))
        }
      }
      function errorHandler (err: Error) {
        this.debug('error waiting for stream to stabilize:', err)
        cleanup()
        reject(err)
      }
      function cleanup () {
        self.removeListener('outgoing', outgoingHandler)
        self.removeListener('error', errorHandler)
        self.removeListener('end', endHandler)
      }

      this.on('outgoing', outgoingHandler)
      this.once('error', errorHandler)
      this.once('end', endHandler)
    })
  }

  /**
   * Set the total amount the stream will receive and wait for that amount to be received.
   * Note that this is absolute, not relative so calling `receiveTotal(100)` twice will only receive 100 units.
   *
   * This promise will only resolve when the absolute amount specified is reached, so lowering the `receiveMax` may cause this not to resolve.
   */
  async receiveTotal (limit: BigNumber.Value): Promise<void> {
    if (this._totalReceived.isGreaterThanOrEqualTo(limit)) {
      this.debug(`already received ${this._totalReceived}, not waiting for more`)
      return Promise.resolve()
    }

    this.setReceiveMax(limit)
    await new Promise((resolve, reject) => {
      const self = this
      function incomingHandler () {
        if (this._totalReceived.isGreaterThanOrEqualTo(limit)) {
          cleanup()
          resolve()
        }
      }
      function endHandler () {
        cleanup()
        if (this._totalReceived.isGreaterThanOrEqualTo(limit)) {
          resolve()
        } else {
          this.debug(`Stream was closed before desired amount was received (target: ${limit}, totalReceived: ${this._totalReceived})`)
          reject(new Error(`Stream was closed before desired amount was received (target: ${limit}, totalReceived: ${this._totalReceived})`))
        }
      }
      function errorHandler (err: Error) {
        this.debug('error waiting for stream to stabilize:', err)
        cleanup()
        reject(err)
      }
      function cleanup () {
        self.removeListener('incoming', incomingHandler)
        self.removeListener('error', errorHandler)
        self.removeListener('end', endHandler)
      }

      this.on('incoming', incomingHandler)
      this.once('error', errorHandler)
      this.once('end', endHandler)
    })
  }

  /**
   * (Internal) Determine how much more the stream can receive
   * @private
   */
  _getAmountStreamCanReceive (): BigNumber {
    return this._receiveMax.minus(this._totalReceived)
  }

  /**
   * (Internal) Add money to the stream (from an external source)
   * @private
   */
  _addToIncoming (amount: BigNumber): void {
    this._totalReceived = this._totalReceived.plus(amount)
    this.debug(`received ${amount} (totalReceived: ${this._totalReceived})`)
    this.emit('incoming', amount.toString())
  }

  /**
   * (Internal) Check how much is available to send
   * @private
   */
  _getAmountAvailableToSend (): BigNumber {
    const amountAvailable = this._sendMax.minus(this._totalSent).minus(this._outgoingHeldAmount)
    return BigNumber.maximum(amountAvailable, 0)
  }

  /**
   * (Internal) Hold outgoing balance
   * @private
   */
  _holdOutgoing (holdId: string, maxAmount?: BigNumber): BigNumber {
    if (this.closed) {
      return new BigNumber(0)
    }
    const amountAvailable = this._getAmountAvailableToSend()
    const amountToHold = (maxAmount ? BigNumber.minimum(amountAvailable, maxAmount) : amountAvailable)
    if (amountToHold.isGreaterThan(0)) {
      this._outgoingHeldAmount = this._outgoingHeldAmount.plus(amountToHold)
      this.holds[holdId] = amountToHold
      this.debug(`holding outgoing balance. holdId: ${holdId}, amount: ${amountToHold}`)
    }
    return amountToHold
  }

  /**
   * (Internal) Execute hold when money has been successfully transferred
   * @private
   */
  _executeHold (holdId: string): void {
    if (!this.holds[holdId]) {
      return
    }
    const amount = this.holds[holdId]
    this._outgoingHeldAmount = this._outgoingHeldAmount.minus(amount)
    this._totalSent = this._totalSent.plus(amount)
    delete this.holds[holdId]
    this.debug(`executed holdId: ${holdId} for: ${amount}`)
    this.emit('outgoing', amount.toString())

    if (this._totalSent.isGreaterThanOrEqualTo(this._sendMax)) {
      this.emit('total_sent')
    }
  }

  /**
   * (Internal) Cancel hold if sending money failed
   * @private
   */
  _cancelHold (holdId: string): void {
    if (!this.holds[holdId]) {
      return
    }
    const amount = this.holds[holdId]
    this.debug(`cancelled holdId: ${holdId} for: ${amount}`)
    this._outgoingHeldAmount = this._outgoingHeldAmount.minus(amount)
    delete this.holds[holdId]
  }

}
