import createLogger, { Logger } from 'ilp-logger'
import Long from 'long'
import { Duplex } from 'stream'
import { DataQueue } from './util/data-queue'
import { OffsetSorter } from './util/data-offset-sorter'
import { LongValue, longFromValue, minLong, checkedAdd, checkedSubtract } from './util/long'
import { IlpPrepare } from 'ilp-packet'

const DEFAULT_TIMEOUT = 60000

const MAX_REMOTE_RECEIVE = Long.MAX_UNSIGNED_VALUE

export interface StreamOpts {
  id: number
  isServer: boolean
  connectionId: string
}

export interface SendOpts {
  timeout?: number
}

export interface ReceiveOpts {
  timeout?: number
}

/**
 * Class used to send money and data over a [Connection]{@link Connection}.
 *
 * This exposes the Node [Duplex Stream](https://nodejs.org/dist/latest-v10.x/docs/api/stream.html#stream_class_stream_duplex) interface for sending data,
 * as well as additional functions for sending money.
 */
export class DataAndMoneyStream extends Duplex {
  readonly id: number

  /** @private */
  _errorMessage?: string
  /** @private */
  _remoteClosed: boolean
  /** @private */
  _remoteReceiveMax: Long
  /** @private */
  _remoteReceived: Long
  /** @private */
  _remoteMaxOffset: number
  /** @private */
  _sentEnd: boolean
  /** @private */
  _remoteSentEnd: boolean

  protected log: Logger
  protected isServer: boolean

  protected _totalSent: Long
  protected _totalReceived: Long
  protected _sendMax: Long
  protected _receiveMax: Long
  protected _outgoingHeldAmount: Long

  protected _closed: boolean
  protected holds: { [id: string]: Long }

  protected _incomingData: OffsetSorter
  protected _outgoingData: DataQueue
  protected _outgoingDataToRetry: { data: Buffer; offset: number }[]
  protected outgoingOffset: number

  protected _receipt?: Buffer

  protected emittedEnd: boolean
  protected emittedClose: boolean

  constructor(opts: StreamOpts) {
    // Half-opened streams are not supported, support may be added in the future.
    super({ allowHalfOpen: false })
    this.id = opts.id
    this.isServer = opts.isServer
    this.log = createLogger(
      `ilp-protocol-stream:${this.isServer ? 'Server' : 'Client'}:Connection:${
        opts.connectionId
      }:Stream:${this.id}`
    )
    this.log.info('new stream created')

    this._totalSent = Long.UZERO
    this._totalReceived = Long.UZERO
    this._sendMax = Long.UZERO
    this._receiveMax = Long.UZERO
    this._outgoingHeldAmount = Long.UZERO

    this._sentEnd = false
    this._remoteSentEnd = false
    this._closed = false
    this.holds = {}

    this._incomingData = new OffsetSorter()
    this._outgoingData = new DataQueue()
    // TODO we might want to merge this with the _outgoingData queue data structure
    this._outgoingDataToRetry = []
    this.outgoingOffset = 0

    this._remoteClosed = false
    this._remoteReceived = Long.UZERO
    this._remoteReceiveMax = MAX_REMOTE_RECEIVE
    // TODO should we have a different default?
    this._remoteMaxOffset = 16384 // 16kb

    this.emittedEnd = false
    this.emittedClose = false
    this.once('end', () => {
      this.emittedEnd = true
    })
    this.once('close', () => {
      this.emittedClose = true
    })
  }

  /**
   * Total amount sent so far, denominated in the connection plugin's units.
   */
  get totalSent(): string {
    return this._totalSent.toString()
  }

  /**
   * Total amount received so far, denominated in the connection plugin's units.
   */
  get totalReceived(): string {
    return this._totalReceived.toString()
  }

  /**
   * The current limit up to which the stream will try to send, denominated in the connection plugin's units.
   * (If the `sendMax` is greater than the `totalSent`, the stream will continue to send the difference)
   */
  get sendMax(): string {
    return this._sendMax.toString()
  }

  /**
   * The current limit up to which the stream will try to receive, denominated in the connection plugin's units.
   * (If the `receiveMax` is greater than the `totalReceived`, the stream will continue to receive money when the other side sends it)
   */
  get receiveMax(): string {
    return this._receiveMax.toString()
  }

  /**
   * Latest receipt for total sent amount.
   */
  get receipt(): Buffer | undefined {
    return this._receipt
  }

  /**
   * Returns true if the stream is open for sending and/or receiving.
   */
  isOpen(): boolean {
    return !this.closed
  }

  /**
   * Set the total amount this stream will send, denominated in the connection plugin's units.
   * Note that this is absolute, not relative so calling `setSendMax(100)` twice will only send 100 units.
   */
  setSendMax(limit: LongValue): void {
    if (this.closed) {
      throw new Error('Stream already closed')
    } else if (typeof limit === 'number' && !isFinite(limit)) {
      throw new Error('sendMax must be finite')
    }
    const sendMax = longFromValue(limit, true)
    if (this._totalSent.greaterThan(sendMax)) {
      this.log.debug(
        'cannot set sendMax to %s because we have already sent: %s',
        sendMax,
        this._totalSent
      )
      throw new Error(`Cannot set sendMax lower than the totalSent`)
    }
    this.log.debug('setting sendMax to %s', sendMax)
    this._sendMax = sendMax
    this.emit('_maybe_start_send_loop')
  }

  /**
   * Event fired when money is received
   * @event money
   * @type {string} Amount of money received, encoded as a string to avoid loss of precision
   */

  /**
   * Set the total amount this stream will receive, denominated in the connection plugin's units.
   * Note that this is absolute, not relative so calling `setReceiveMax(100)` twice will only let the stream receive 100 units.
   * @fires money
   */
  setReceiveMax(limit: LongValue): void {
    if (this.closed) {
      throw new Error('Stream already closed')
    }
    const receiveMax = longFromValue(limit, true)
    if (this._totalReceived.greaterThan(receiveMax)) {
      this.log.debug(
        'cannot set receiveMax to %s because we have already received: %s',
        receiveMax,
        this._totalReceived
      )
      throw new Error('Cannot set receiveMax lower than the totalReceived')
    }
    if (this._receiveMax.greaterThan(receiveMax)) {
      this.log.debug(
        'cannot set receiveMax to %s because the current limit is: %s',
        receiveMax,
        this._receiveMax
      )
      throw new Error('Cannot decrease the receiveMax')
    }
    this.log.debug('setting receiveMax to %s', receiveMax)
    this._receiveMax = receiveMax
    this.emit('_maybe_start_send_loop')
  }

  /**
   * Set the total amount the stream will send and wait for that amount to be sent.
   * Note that this is absolute, not relative so calling `sendTotal(100)` twice will only send 100 units.
   *
   * This promise will only resolve when the absolute amount specified is reached, so lowering the `sendMax` may cause this not to resolve.
   */
  async sendTotal(_limit: LongValue, opts?: SendOpts): Promise<void> {
    const limit = longFromValue(_limit, true)
    const timeout = (opts && opts.timeout) || DEFAULT_TIMEOUT
    if (this._totalSent.greaterThanOrEqual(limit)) {
      this.log.debug('already sent %s, not sending any more', this._totalSent)
      return Promise.resolve()
    }

    this.setSendMax(limit)
    await new Promise<void>((resolve, reject) => {
      const outgoingHandler = () => {
        if (this._totalSent.greaterThanOrEqual(limit)) {
          cleanup()
          resolve()
        }
      }
      const endHandler = () => {
        // Clean up on next tick in case an error was also emitted
        setTimeout(cleanup)
        if (this._totalSent.greaterThanOrEqual(limit)) {
          resolve()
        } else {
          this.log.debug(
            'Stream was closed before the desired amount was sent (target: %s, totalSent: %s)',
            limit,
            this._totalSent
          )
          reject(
            new Error(
              `Stream was closed before the desired amount was sent (target: ${limit}, totalSent: ${this._totalSent})`
            )
          )
        }
      }
      const errorHandler = (err: Error) => {
        this.log.debug('error waiting for stream to stabilize:', err)
        cleanup()
        reject(
          new Error(
            `Stream encountered an error before the desired amount was sent (target: ${limit}, totalSent: ${this._totalSent}): ${err}`
          )
        )
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(
          new Error(
            `Timed out before the desired amount was sent (target: ${limit}, totalSent: ${this._totalSent})`
          )
        )
      }, timeout)
      const cleanup = () => {
        clearTimeout(timer)
        this.removeListener('outgoing_money', outgoingHandler)
        this.removeListener('error', errorHandler)
        this.removeListener('end', endHandler)
      }

      this.on('outgoing_money', outgoingHandler)
      this.on('error', errorHandler)
      this.on('end', endHandler)
    })
  }

  /**
   * Set the total amount the stream will receive and wait for that amount to be received.
   * Note that this is absolute, not relative so calling `receiveTotal(100)` twice will only receive 100 units.
   *
   * This promise will only resolve when the absolute amount specified is reached, so lowering the `receiveMax` may cause this not to resolve.
   */
  async receiveTotal(_limit: LongValue, opts?: ReceiveOpts): Promise<void> {
    const limit = longFromValue(_limit, true)
    const timeout = (opts && opts.timeout) || DEFAULT_TIMEOUT
    if (this._totalReceived.greaterThanOrEqual(limit)) {
      this.log.debug('already received %s, not waiting for more', this._totalReceived)
      return Promise.resolve()
    }

    this.setReceiveMax(limit)
    await new Promise<void>((resolve, reject) => {
      const moneyHandler = () => {
        if (this._totalReceived.greaterThanOrEqual(limit)) {
          cleanup()
          resolve()
        }
      }
      const endHandler = () => {
        // Clean up on next tick in case an error was also emitted
        setTimeout(cleanup)
        if (this._totalReceived.greaterThanOrEqual(limit)) {
          resolve()
        } else {
          this.log.debug(
            'Stream was closed before the desired amount was received (target: %s, totalReceived: %s)',
            limit,
            this._totalReceived
          )
          reject(
            new Error(
              `Stream was closed before the desired amount was received (target: ${limit}, totalReceived: ${this._totalReceived})`
            )
          )
        }
      }
      const errorHandler = (err: Error) => {
        this.log.debug('error waiting for stream to stabilize:', err)
        cleanup()
        reject(
          new Error(
            `Stream encountered an error before the desired amount was received (target: ${limit}, totalReceived: ${this._totalReceived}): ${err}`
          )
        )
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(
          new Error(
            `Timed out before the desired amount was received (target: ${limit}, totalReceived: ${this._totalReceived})`
          )
        )
      }, timeout)
      const cleanup = () => {
        clearTimeout(timer)
        this.removeListener('money', moneyHandler)
        this.removeListener('error', errorHandler)
        this.removeListener('end', endHandler)
      }

      this.on('money', moneyHandler)
      this.on('error', errorHandler)
      this.on('end', endHandler)
    })
  }

  /**
   * (Internal) Determine how much more the stream can receive
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _getAmountStreamCanReceive(): Long {
    if (this._receiveMax.lessThan(this._totalReceived)) {
      return Long.UZERO
    }
    return checkedSubtract(this._receiveMax, this._totalReceived).difference
  }

  /**
   * (Internal) Add money to the stream (from an external source)
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _addToIncoming(amount: Long, prepare: IlpPrepare): void {
    // If this overflows, it will als be caught (and handled) at the connection level.
    this._totalReceived = checkedAdd(this._totalReceived, amount).sum
    this.log.trace('received %s (totalReceived: %s)', amount, this._totalReceived)
    this.emit('money', amount.toString(), prepare)
  }

  /**
   * (Internal) Check how much is available to send
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _getAmountAvailableToSend(): Long {
    if (this.closed) {
      return Long.UZERO
    }
    const amountAvailable = checkedSubtract(
      checkedSubtract(this._sendMax, this._totalSent).difference,
      this._outgoingHeldAmount
    ).difference
    return amountAvailable
  }

  /**
   * (Internal) Hold outgoing balance
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _holdOutgoing(holdId: string, maxAmount?: Long): Long {
    const amountAvailable = this._getAmountAvailableToSend()
    const amountToHold = maxAmount ? minLong(amountAvailable, maxAmount) : amountAvailable
    if (amountToHold.greaterThan(0)) {
      this._outgoingHeldAmount = this._outgoingHeldAmount.add(amountToHold)
      this.holds[holdId] = amountToHold
      this.log.trace('holding outgoing balance. holdId: %s, amount: %s', holdId, amountToHold)
    }
    return amountToHold
  }

  /**
   * (Internal) Execute hold when money has been successfully transferred
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _executeHold(holdId: string): void {
    if (!this.holds[holdId]) {
      return
    }
    const amount = this.holds[holdId]
    this._outgoingHeldAmount = this._outgoingHeldAmount.subtract(amount)
    this._totalSent = this._totalSent.add(amount)
    delete this.holds[holdId]
    this.log.trace('executed holdId: %s for: %s', holdId, amount)
    this.emit('outgoing_money', amount.toString())

    if (this._totalSent.greaterThanOrEqual(this._sendMax)) {
      this.log.debug('outgoing total sent')
      this.emit('outgoing_total_sent')
    }
  }

  /**
   * (Internal) Cancel hold if sending money failed
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _cancelHold(holdId: string): void {
    if (!this.holds[holdId]) {
      return
    }
    const amount = this.holds[holdId]
    this.log.trace('cancelled holdId: %s for: %s', holdId, amount)
    this._outgoingHeldAmount = this._outgoingHeldAmount.subtract(amount)
    delete this.holds[holdId]
  }

  /**
   * (Called internally by the Node Stream when the stream ends)
   * @private
   */
  _final(callback: (error: Error | null | undefined) => void): void {
    this.log.info('stream is closing')
    const finish = (err?: Error) => {
      if (err) {
        this.log.debug('error waiting for money to be sent:', err)
      }
      this.log.info('stream ended')
      this._closed = true
      // Only emit the 'close' & 'end' events if the stream doesn't automatically
      setTimeout(() => {
        if (!this.emittedEnd) {
          this.emittedEnd = true
          this.safeEmit('end')
        }
        if (!this.emittedClose) {
          this.emittedClose = true
          this.safeEmit('close')
        }
      })
      callback(err)
    }

    if (this._remoteSentEnd || this._sendMax.lessThanOrEqual(this._totalSent)) {
      finish()
    } else {
      this.log.info('waiting to finish sending money before ending stream')

      new Promise((resolve, reject) => {
        this.once('outgoing_total_sent', resolve)
        this.once('_send_loop_finished', resolve)
        this.once('error', (error: Error) => reject(error))
      })
        .then(() => finish())
        .catch(finish)
    }
  }

  /**
   * (Called internally by the Node Stream when stream.destroy is called)
   * @private
   */
  _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.log.error('destroying stream because of error:', error)
    this._closed = true
    if (error) {
      this._errorMessage = error.message
    }
    // Only emit the 'close' & 'end' events if the stream doesn't automatically
    setTimeout(() => {
      if (!this.emittedEnd) {
        this.emittedEnd = true
        this.safeEmit('end')
      }
      if (!this.emittedClose) {
        this.emittedClose = true
        this.safeEmit('close')
      }
    })
    callback(error)
  }

  /**
   * (Called internally by the Node Stream when stream.write is called)
   * @private
   */
  _write(chunk: Buffer, encoding: string, callback: () => void): void {
    this.log.trace('%d bytes written to the outgoing data queue', chunk.length)
    this._outgoingData.push(chunk, callback)
    this.emit('_maybe_start_send_loop')
  }

  /**
   * (Called internally by the Node Stream when stream.write is called)
   * @private
   */
  _writev(chunks: { chunk: Buffer; encoding: string }[], callback: () => void): void {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      this.log.trace('%d bytes written to the outgoing data queue', chunk.chunk.length)
      // Only call the callback when the last chunk has been sent out
      if (i === chunks.length - 1) {
        this._outgoingData.push(chunk.chunk, callback)
      } else {
        this._outgoingData.push(chunk.chunk)
      }
    }
    this.emit('_maybe_start_send_loop')
  }

  /**
   * (Called internally by the Node Stream when stream.read is called)
   * @private
   */
  _read(size: number): void {
    const data = this._incomingData.read()
    if (!data) {
      // Let the peer know that this stream can receive more data.
      // Don't call immediately since looping before the read() has finished
      // would report incorrect offsets.
      if (this['readableFlowing'] !== true) {
        setTimeout(() => this.emit('_maybe_start_send_loop'))
      }
      return
    }
    this.push(data)
    if (data.length < size) {
      this._read(size - data.length)
    }
  }

  /**
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _hasDataToSend(): boolean {
    return !this._outgoingData.isEmpty() || this._outgoingDataToRetry.length > 0
  }

  /**
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _getAvailableDataToSend(size: number): { data: Buffer | undefined; offset: number } {
    // See if we have data that needs to be resent
    if (this._outgoingDataToRetry.length > 0) {
      const toSend = this._outgoingDataToRetry[0]
      if (toSend.data.length > size) {
        const data = toSend.data.slice(0, size)
        const offset = toSend.offset
        toSend.data = toSend.data.slice(size)
        toSend.offset = toSend.offset + size
        return { data, offset }
      } else {
        this._outgoingDataToRetry.shift()
        return toSend
      }
    }

    // Send new data if the remote can receive more data
    const maxBytes = Math.min(size, this._remoteMaxOffset - this.outgoingOffset)
    const offset = this.outgoingOffset
    const data = this._outgoingData.read(maxBytes)
    if (data && data.length > 0) {
      this.outgoingOffset += data.length
      this.log.trace('%d bytes taken from the outgoing data queue', data.length)
    }
    return { data, offset }
  }

  /**
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _resendOutgoingData(data: Buffer, offset: number) {
    this.log.trace('re-queuing %d bytes of data starting at offset %d', data.length, offset)
    this._outgoingDataToRetry.push({ data, offset })
  }

  /**
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _isDataBlocked(): number | undefined {
    if (this._remoteMaxOffset < this.outgoingOffset + this._outgoingData.byteLength()) {
      return this.outgoingOffset + this._outgoingData.byteLength()
    }
  }

  /**
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _getOutgoingOffsets(): { current: number; max: number } {
    return {
      current: this.outgoingOffset,
      max: this.outgoingOffset + this._outgoingData.byteLength(),
    }
  }

  /**
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _getIncomingOffsets(): { max: number; current: number; maxAcceptable: number } {
    return {
      max: this._incomingData.maxOffset,
      current: this._incomingData.readOffset,
      maxAcceptable:
        this._incomingData.readOffset + this.readableHighWaterMark - this.readableLength,
    }
  }

  /**
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _pushIncomingData(data: Buffer, offset: number) {
    this._incomingData.push(data, offset)

    this._read(this.readableHighWaterMark - this.readableLength)
  }

  /**
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _remoteEnded(err?: Error): void {
    this.log.info('remote closed stream')
    this._remoteSentEnd = true
    this._remoteClosed = true
    if (err) {
      this.destroy(err)
    } else {
      this.push(null)
      this.end()
    }
  }

  /**
   * (Used by the Connection class but not meant to be part of the public API)
   * @private
   */
  _setReceipt(receipt: Buffer): void {
    this._receipt = receipt
  }

  protected safeEmit(...args: Parameters<typeof Duplex.prototype.emit>) {
    const event = args[0]
    try {
      this.emit(...args)
    } catch (err) {
      this.log.debug('error in %s handler: %s', event, err)
    }
  }
}

// We set this outside the class definition due to typing issues
// TS2611: 'closed' is defined as a property in class 'Duplex', but is overridden here in 'DataAndMoneyStream' as an accessor.
Object.defineProperty(DataAndMoneyStream.prototype, 'closed', {
  get(this: DataAndMoneyStream) {
    return this._closed
  },
  enumerable: true,
  configurable: true,
})
