import EventEmitter3 = require('eventemitter3')
import * as Debug from 'debug'
import BigNumber from 'bignumber.js'
import 'source-map-support/register'

export interface MoneyStreamOpts {
  id: number,
  isServer: boolean
}

export class MoneyStream extends EventEmitter3 {
  readonly id: number
  _sentClose: boolean

  _remoteReceiveMax?: BigNumber
  _remoteReceived?: BigNumber

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

    this._sentClose = false
    this.closed = false
    this.holds = {}
  }

  get totalSent (): string {
    return this._totalSent.toString()
  }

  get totalReceived (): string {
    return this._totalReceived.toString()
  }

  get sendMax (): string {
    return this._sendMax.toString()
  }

  get receiveMax (): string {
    return this._receiveMax.toString()
  }

  close (): void {
    this.emit('close')
    this.closed = true
  }

  isClosed (): boolean {
    return this.closed
  }

  setSendMax (amount: BigNumber.Value): void {
    if (this.closed) {
      throw new Error('Stream already closed')
    }
    if (this._totalSent.isGreaterThan(amount)) {
      this.debug(`cannot set sendMax to ${amount} because we have already sent: ${this._totalSent}`)
      throw new Error(`Cannot lower sendMax beyond how much has already been sent`)
    }
    this.debug(`setting sendMax to ${amount}`)
    this._sendMax = new BigNumber(amount)
    this.emit('_send')
  }

  setReceiveMax (amount: BigNumber.Value): void {
    if (this.closed) {
      throw new Error('Stream already closed')
    }
    if (this._totalReceived.isGreaterThan(amount)) {
      this.debug(`cannot set receiveMax to ${amount} because we have already received: ${this._totalReceived}`)
      throw new Error(`Cannot lower receiveMax beyond how much has already been received`)
    }
    this.debug(`setting receiveMax to ${amount}`)
    this._receiveMax = new BigNumber(amount)
    this.emit('_send')
  }

  async sendTotal (amount: BigNumber.Value): Promise<void> {
    this.setSendMax(amount)
    if (this._totalSent.isGreaterThanOrEqualTo(amount)) {
      this.debug(`already sent ${this._totalSent}, not sending any more`)
      return Promise.resolve()
    }
    await new Promise((resolve, reject) => {
      const self = this
      function outgoingHandler () {
        if (this._totalSent.isGreaterThanOrEqualTo(amount)) {
          cleanup()
          resolve()
        }
      }
      function endHandler () {
        cleanup()
        if ((this._totalSent.isGreaterThanOrEqualTo(amount))) {
          resolve()
        } else {
          this.debug(`Stream ended before desired amount was sent (target: ${amount}, totalSent: ${this._totalSent})`)
          reject(new Error(`Stream ended before desired amount was sent (target: ${amount}, totalSent: ${this._totalSent})`))
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

  async receiveTotal (amount: BigNumber.Value): Promise<void> {
    this.setReceiveMax(amount)
    if (this._totalReceived.isGreaterThanOrEqualTo(amount)) {
      this.debug(`already received ${this._totalReceived}, not waiting for more`)
      return Promise.resolve()
    }
    await new Promise((resolve, reject) => {
      const self = this
      function incomingHandler () {
        if (this._totalReceived.isGreaterThanOrEqualTo(amount)) {
          cleanup()
          resolve()
        }
      }
      function endHandler () {
        cleanup()
        if (this._totalReceived.isGreaterThanOrEqualTo(amount)) {
          resolve()
        } else {
          this.debug(`Stream ended before desired amount was received (target: ${amount}, totalReceived: ${this._totalReceived})`)
          reject(new Error(`Stream ended before desired amount was received (target: ${amount}, totalReceived: ${this._totalReceived})`))
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
