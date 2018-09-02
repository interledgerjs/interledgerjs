import * as WebSocket from 'ws'
const createLogger = require('ilp-logger')
import { EventEmitter2 } from 'eventemitter2'
const debug = createLogger('ilp-ws-reconnect')

const DEFAULT_RECONNECT_INTERVAL = 5000

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
  interval?: number
  WebSocket: WebSocketConstructor
}

/**
 * Websocket clients with reconnect capability.
 */
export class WebSocketReconnector extends EventEmitter2 {
  /**
   * Reconnect interval.
   */
  private _interval: number

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
    this._interval = options.interval || DEFAULT_RECONNECT_INTERVAL
    this.WebSocket = options.WebSocket
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
  send (data: any, cb?: (err: Error) => void): void {
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
  }

  /**
   * Triggered on `close` or `error` event from `open ()`. If triggered, all
   * listeners are removed, reconnect happens. The process continues to try to
   * reconnect on the interval by calling the `open()' function and cycling
   * between reconnect to clean up old listeners.
   */
  private _reconnect (codeOrError: number | Error) {
    debug.debug(`websocket disconnected with ${codeOrError}; reconnect in ${this._interval}`)
    this._connected = false
    this._instance.removeAllListeners()
    setTimeout(() => {
      void this.open(this._url)
    }, this._interval)
    this.emit('close')
  }
}
