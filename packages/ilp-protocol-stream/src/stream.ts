import EventEmitter3 = require('eventemitter3')
import * as Debug from 'debug'
import BigNumber from 'bignumber.js'
import { Duplex } from 'stream'
require('source-map-support').install()

export interface StreamOpts {
  id: number,
  isServer: boolean
}

/**
 * Stream for sending money over an ILP STREAM connection.
 */
export class DataAndMoneyStream extends Duplex {
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

  protected _incomingData: OffsetSorter
  protected _outgoingData: DataQueue
  protected outgoingOffset: number
  protected ended: boolean

  constructor (opts: StreamOpts) {
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

    this._incomingData = new OffsetSorter()
    this._outgoingData = new DataQueue()
    this.outgoingOffset = 0
    this.ended = false
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
    this.closed = true
    super.end()
    this.emit('end')
    // TODO should we emit the event (or return a promise that resolves)
    // after we're done sending all the queued data and money?
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
    const sendMax = new BigNumber(limit)
    if (this._totalSent.isGreaterThan(sendMax)) {
      this.debug(`cannot set sendMax to ${sendMax} because we have already sent: ${this._totalSent}`)
      throw new Error(`Cannot set sendMax lower than the totalSent`)
    }
    if (!sendMax.isFinite()) {
      throw new Error('sendMax must be finite')
    }
    this.debug(`setting sendMax to ${sendMax}`)
    this._sendMax = sendMax
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
        self.removeListener('outgoing_money', outgoingHandler)
        self.removeListener('error', errorHandler)
        self.removeListener('end', endHandler)
      }

      this.on('outgoing_money', outgoingHandler)
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
      function moneyHandler () {
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
        self.removeListener('money', moneyHandler)
        self.removeListener('error', errorHandler)
        self.removeListener('end', endHandler)
      }

      this.on('money', moneyHandler)
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
    this.emit('money', amount.toString())
  }

  /**
   * (Internal) Check how much is available to send
   * @private
   */
  _getAmountAvailableToSend (): BigNumber {
    if (this.closed) {
      return new BigNumber(0)
    }
    const amountAvailable = this._sendMax.minus(this._totalSent).minus(this._outgoingHeldAmount)
    return BigNumber.maximum(amountAvailable, 0)
  }

  /**
   * (Internal) Hold outgoing balance
   * @private
   */
  _holdOutgoing (holdId: string, maxAmount?: BigNumber): BigNumber {
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
    this.emit('outgoing_money', amount.toString())

    if (this._totalSent.isGreaterThanOrEqualTo(this._sendMax)) {
      this.emit('outgoing_total_sent')
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

  _final (callback: (...args: any[]) => void): void {
    callback()
  }

  _write (chunk: Buffer, encoding: string, callback: (...args: any[]) => void): void {
    this._outgoingData.push(chunk)
    this.emit('_send')
    callback()
  }

  _read (size: number): void {
    const data = this._incomingData.read()
    if (data) {
      if (this.push(data) && size > data.length) {
        this._read(size - data.length)
        return
      }
    }

    if (!this.ended && this._incomingData.isEnd()) {
      this.ended = true
      this.push(null)
    }
  }

  _hasDataToSend (): boolean {
    return !this._outgoingData.isEmpty()
  }

  _getAvailableDataToSend (size: number): { data: Buffer | undefined, offset: number } {
    const data = this._outgoingData.read(size)
    const offset = this.outgoingOffset
    if (data) {
      this.outgoingOffset = this.outgoingOffset += data.length
    }
    return { data, offset }
  }

  _pushIncomingData (data: Buffer, offset: number) {
    this._incomingData.push(data, offset)

    // TODO how much should we try to read?
    this._read(data.length)
  }

  _remoteEnded (): void {
    this.ended = true
  }
}

// Inspired by https://github.com/toajs/quic/blob/master/src/stream.ts

export class DataQueueEntry {
  data: Buffer
  next?: DataQueueEntry
  constructor (buf: Buffer, entry?: DataQueueEntry) {
    this.data = buf
    this.next = entry
  }
}

export class DataQueue {
  head?: DataQueueEntry
  tail?: DataQueueEntry
  length: number
  constructor () {
    this.length = 0
  }

  push (buf: Buffer): void {
    const entry = new DataQueueEntry(buf)

    if (this.tail != null) {
      this.tail.next = entry
    } else {
      this.head = entry
    }
    this.tail = entry
    this.length += 1
  }

  shift () {
    if (this.head == null) {
      return null
    }
    const ret = this.head.data
    if (this.length === 1) {
      this.head = this.tail = undefined
    } else {
      this.head = this.head.next
    }
    this.length -= 1
    return ret
  }

  read (n: number): Buffer | undefined {
    if (this.head === undefined) {
      return undefined
    }

    let ret = this.head.data
    if (ret.length > n) {
      this.head.data = ret.slice(n)
      ret = ret.slice(0, n)
      return ret
    }
    this.shift()
    return ret // ret.length <= n
  }

  isEmpty (): boolean {
    return this.length === 0
  }
}

export class OffsetDataEntry {
  data?: Buffer
  offset: number
  next?: OffsetDataEntry
  constructor (data: Buffer, offset: number, next?: OffsetDataEntry) {
    this.data = data
    this.offset = offset
    this.next = next
  }
}

export class OffsetSorter {
  head?: OffsetDataEntry
  readOffset: number
  endOffset: number
  constructor () {
    this.readOffset = 0
    this.endOffset = -1
  }

  setEndOffset (offset: number) {
    this.endOffset = offset
  }

  isEnd (): boolean {
    return this.readOffset === this.endOffset
  }

  push (data: Buffer, offset: number) {
    const entry = new OffsetDataEntry(data, offset)

    if (this.head == null) {
      this.head = entry
    } else if (this.head.offset > offset) {
      entry.next = this.head
      this.head = entry
    } else {
      let prev = this.head
      while (true) {
        if (prev.next == null) {
          prev.next = entry
          break
        }
        if (prev.next.offset > offset) {
          entry.next = prev.next
          prev.next = entry
          break
        }
        prev = prev.next
      }
    }
  }

  read (): Buffer | undefined {
    let data
    if (this.head != null && this.readOffset === this.head.offset) {
      data = this.head.data
      this.readOffset = this.head.offset + (data != null ? data.length : 0)
      this.head = this.head.next
    }
    return data
  }
}
