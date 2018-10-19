import * as WebSocket from 'ws'
const createLogger = require('ilp-logger')
import { EventEmitter2 } from 'eventemitter2'
const debug = createLogger('ilp-ws-reconnect')

const DEFAULT_TRY_CLEAR_TIMEOUT = 10000
const DEFAULT_RECONNECT_INTERVALS = [
  0,
  100,
  500,
  1000,
  2000,
  5000
]

/**
 * Accepts URL string pointing to connection endpoint.
 */
export interface WebSocketConstructor {
  new (url: string): WebSocket
}

/**
 * Reconnect interval specifies how long to wait before trying to connect to the
 * websocket endpoint if a connection is not established successfully.
 */
export interface WebSocketReconnectorConstructorOptions {
  intervals?: Array<number>,
  interval?: number,
  clearTryTimeout?: number,
  WebSocket: WebSocketConstructor
}

/**
 * Websocket clients with reconnect capability.
 */
export class WebSocketReconnector extends EventEmitter2 {
  /**
   * Reconnect information. Intervals is a list of timeouts for
   * successive reconnect attempts. `clearTryTimeout` ms after
   * the last reconnect attempt, the number of tries will reset.
   */
  private _intervals: Array<number>
  private _clearTryTimeout: number
  private _clearTryTimer?: NodeJS.Timer
  private _openTimer?: NodeJS.Timer
  private _tries: number

  /**
   * URL endpoint of websocket server.
   */
  private _url: string

  /**
   * Websocket connection.
   */
  private _instance: WebSocket

  /**
   * Is websocket connection connected to endpoint?
   */
  private _connected: boolean

  /**
   * Websocket constructor.
   */
  private WebSocket: WebSocketConstructor

  constructor (options: WebSocketReconnectorConstructorOptions) {
    super()
    this.WebSocket = options.WebSocket

    this._clearTryTimeout = options.clearTryTimeout ||
      DEFAULT_TRY_CLEAR_TIMEOUT

    this._tries = 0
    this._intervals = options.intervals ||
      (options.interval && [ options.interval ]) ||
      DEFAULT_RECONNECT_INTERVALS
  }

  /**
   * Define a number of listeners. On open: emit an open event. On close or
   * error: try to reconnect. On message, emit a message event with the data.
   * Return a promise which resolves when the connection is successfully
   * established (successfully established connection emits `open` event).
   */
  open (url: string) {
    this._url = url
    this._instance = new (this.WebSocket)(this._url)
    this._instance.on('open', () => void this.emit('open'))
    this._instance.on('close', (code: number, reason: string) => this._reconnect(code))
    this._instance.on('error', (err: Error) => this._reconnect(err))
    this._instance.on('message', (data: WebSocket.Data) => void this.emit('message', data))
    return new Promise((resolve) => void this.once('open', resolve))
  }

  /**
   * Wrapper for regular websocket send function.
   */
  send (data: any, cb?: (err?: Error) => void): void {
    return this._instance.send(data, cb)
  }

  /**
   * Remove all listeners from the websocket instance prior to emitting `close` and
   * closing the websocket. The listeners were removed so that calling this
   * `close ()` would not trigger a reconnect.
   */
  close () {
    this._instance.removeAllListeners()
    this.emit('close')
    this._instance.close()

    if (this._openTimer) clearTimeout(this._openTimer)
    if (this._clearTryTimer) clearTimeout(this._clearTryTimer)
  }

  /**
   * Triggered on `close` or `error` event from `open ()`. If triggered, all
   * listeners are removed, reconnect happens. The process continues to try to
   * reconnect on the interval by calling the `open()' function and cycling
   * between reconnect to clean up old listeners.
   */
  private _reconnect (codeOrError: number | Error) {
    debug.debug(`websocket disconnected with ${codeOrError}; reconnect in ${this._intervals[this._tries]}}`)
    this._connected = false
    this._instance.removeAllListeners()
    this._openTimer = setTimeout(() => {
      void this.open(this._url)
    }, this._intervals[this._tries])
    this._tries = Math.min(this._tries + 1, this._intervals.length - 1)

    if (this._clearTryTimer) {
      clearTimeout(this._clearTryTimer)
    }

    this._clearTryTimer = setTimeout(() => {
      delete this._clearTryTimer
      this._tries = 0
    }, this._clearTryTimeout)

    // browser timers don't support unref
    /* tslint:disable-next-line:strict-type-predicates */
    if (typeof this._clearTryTimer.unref === 'function') {
      this._clearTryTimer.unref()
    }

    this.emit('close')
  }
}
