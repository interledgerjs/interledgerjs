import { EventEmitter } from 'events'

class WebSocketPolyfill extends EventEmitter {
  private _ws: WebSocket
  constructor(uri: string) {
    super()
    this._ws = new WebSocket(uri)
    this._ws.binaryType = 'arraybuffer'
    this._ws.onerror = this.emit.bind(this, 'error')
    this._ws.onopen = this.emit.bind(this, 'open')
    this._ws.onclose = this.emit.bind(this, 'close')
    this._ws.onmessage = msg => {
      this.emit('message', Buffer.from(msg.data))
    }
  }

  send(msg: Buffer, cb: (err?: Error) => void) {
    if (
      this._ws.readyState === WebSocket.CONNECTING ||
      this._ws.readyState === WebSocket.OPEN
    ) {
      this._ws.send(msg.buffer)
      process.nextTick(cb)
    } else {
      process.nextTick(cb, new Error('already closed'))
    }
  }

  /**
   * This does not seem necessary to implement:
   * see: https://github.com/interledgerjs/ilp-plugin-btp/commit/9975a2129f55fe57a16686beb66c22363ffbea7f#diff-7890877dd7f005f29976f46177e3e756R142
   * see: https://github.com/websockets/ws/blob/master/lib/sender.js#L47
   * see: https://github.com/websockets/ws/blob/master/lib/sender.js#L173
   */
  // tslint:disable-next-line:no-empty
  ping() {}

  close() {
    this._ws.close()
  }
}

export = WebSocketPolyfill
