'use strict'

const WebSocket = require('ws')
const debug = require('debug')('ilp-ws-reconnect')
const EventEmitter2 = require('eventemitter2')
const DEFAULT_RECONNECT_INTERVAL = 5000

class WebSocketReconnector extends EventEmitter2 {
  constructor ({ interval }) {
    super()
    this._interval = interval || DEFAULT_RECONNECT_INTERVAL
  }

  open (url) {
    this._url = url
    this._instance = new WebSocket(this._url)
    this._instance.on('open', () => void this.emit('open'))
    this._instance.on('close', (err) => this._reconnect(err))
    this._instance.on('error', (err) => this._reconnect(err))
    this._instance.on('message', (data, flags) => void this.emit('message', data, flags))
    return new Promise((resolve) => void this.once('open', resolve))
  }

  // uses callback to match normal ws api
  send (data, callback) {
    return this._instance.send(data, callback)
  }

  _reconnect (code) {
    debug(`websocket disconnected with ${code}; reconnect in ${this._interval}`)
    this._connected = false
    this._instance.removeAllListeners()
    setTimeout(() => {
      this.open(this._url)
    }, this._interval)
    this.emit('close')
  }

  close () {
    this._instance.removeAllListeners()
    this.emit('close')
    this._instance.close()
  }
}

module.exports = WebSocketReconnector
