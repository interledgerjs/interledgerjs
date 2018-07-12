import * as assert from 'assert'
import * as crypto from 'crypto'
import * as Debug from 'debug'
import * as WebSocket from 'ws'
import { WebSocketReconnector, WebSocketConstructor } from './ws-reconnect'
import { DataHandler, MoneyHandler } from 'ilp-compat-plugin'
import { EventEmitter2, Listener } from 'eventemitter2'
import { URL } from 'url'
import { protocolDataToIlpAndCustom, ilpAndCustomToProtocolData } from './protocol-data-converter'

const BtpPacket = require('btp-packet')

const debug = require('ilp-logger')('ilp-plugin-btp')

enum ReadyState {
  INITIAL = 0,
  CONNECTING = 1,
  CONNECTED = 2,
  DISCONNECTED = 3,
  READY_TO_EMIT = 4
}

const DEFAULT_TIMEOUT = 35000
const namesToCodes = {
  'UnreachableError': 'T00',
  'NotAcceptedError': 'F00',
  'InvalidFieldsError': 'F01',
  'TransferNotFoundError': 'F02',
  'InvalidFulfillmentError': 'F03',
  'DuplicateIdError': 'F04',
  'AlreadyRolledBackError': 'F05',
  'AlreadyFulfilledError': 'F06',
  'InsufficientBalanceError': 'F07'
}

function jsErrorToBtpError (e: Error) {
  const name: string = e.name || 'NotAcceptedError'
  const code: string = namesToCodes[name] || 'F00'

  return {
    code,
    name,
    triggeredAt: new Date(),
    data: JSON.stringify({ message: e.message })
  }
}

const ILP_PACKET_TYPES = {
  12: 'ilp-prepare',
  13: 'ilp-fulfill',
  14: 'ilp-reject'
}
function generatePacketDataTracer (packetData: BtpPacketData) {
  return {
    toString: () => {
      try {
        return packetData.protocolData.map(data => {
          switch (data.protocolName) {
            case 'ilp':
              return ILP_PACKET_TYPES[data.data[0]] || ('ilp-' + data.data[0])
              break
            default:
              return `${data.protocolName}=${data.data.toString('base64')}`
          }
        }).join(';')
      } catch (err) {
        return 'serialization error. err=' + err.stack
      }
    }
  }
}

export interface BtpPacket {
  requestId: number
  type: number
  data: BtpPacketData
}

export interface BtpPacketData {
  protocolData: Array<BtpSubProtocol>
  amount?: string
  code?: string
  name?: string
  triggeredAt?: Date
  data?: string
}

export interface BtpSubProtocol {
  protocolName: string
  contentType: number
  data: Buffer
}

export interface IlpPluginBtpConstructorOptions {
  server?: string,
  listener?: {
    port: number,
    secret: string
  },
  reconnectInterval?: number
  responseTimeout?: number
}

export interface WebSocketServerConstructor {
  new (opts: WebSocket.ServerOptions): WebSocket.Server
}

export interface IlpPluginBtpConstructorModules {
  log?: any
  WebSocket?: WebSocketConstructor
  WebSocketServer?: WebSocketServerConstructor
}

/** Abstract base class for building BTP-based ledger plugins.
 *
 * This class takes care of most of the work translating between BTP and the
 * ledger plugin interface (LPI).
 *
 * You need to implement:
 *
 * sendMoney (amount), handleMoney (from, btpPacket)
 *
 * The `from` field is set to null in all the methods here. It is present in
 * order to make it possible to write multi account plugins (plugins with an
 * internal connector which understand ILP).
 *
 * If any work must be done on disconnect, implement _disconnect instead of
 * overriding this.disconnect. This will ensure that the connection is cleaned
 * up properly.
 *
 * If any work must be done on connect, implement _connect. You can also
 * rewrite connect, but then disconnect and handleOutgoingBtpPacket should also
 * be overridden.
 *
 * Instead, you need to implement _handleOutgoingBtpPacket(to, btpPacket) which
 * returns a Promise. `to` is the ILP address of the destination peer and
 * `btpPacket` is the BTP packet as a JavaScript object.
 *
 * You can call _handleIncomingBtpPacket(from, btpPacket) to trigger all the
 * necessary LPI events in response to an incoming BTP packet. `from` is the
 * ILP address of the peer and `btpPacket` is the parsed BTP packet.
 */
export default class AbstractBtpPlugin extends EventEmitter2 {
  public static version = 2

  private _reconnectInterval?: number
  private _responseTimeout: number

  protected _dataHandler?: DataHandler
  protected _moneyHandler?: MoneyHandler
  private _readyState: ReadyState = ReadyState.INITIAL
  private _log: any
  private WebSocket: WebSocketConstructor
  private WebSocketServer: WebSocketServerConstructor

  // Server
  private _listener?: {
    port: number,
    secret: string
  }
  protected _wss: WebSocket.Server | null = null
  private _incomingWs?: WebSocket

  // Client
  private _server?: string
  private _ws?: WebSocketReconnector

  constructor (options: IlpPluginBtpConstructorOptions, modules?: IlpPluginBtpConstructorModules) {
    super()

    this._reconnectInterval = options.reconnectInterval // optional
    this._responseTimeout = options.responseTimeout || DEFAULT_TIMEOUT
    this._listener = options.listener
    this._server = options.server

    modules = modules || {}
    this._log = modules.log || debug
    this._log.trace = this._log.trace || Debug(this._log.debug.namespace + ':trace')
    this.WebSocket = modules.WebSocket || WebSocket
    this.WebSocketServer = modules.WebSocketServer || WebSocket.Server
  }

  /* tslint:disable-next-line:no-empty */
  protected async _connect (): Promise<void> {}
  /* tslint:disable-next-line:no-empty */
  protected async _disconnect (): Promise<void> {}

  async connect () {
    if (this._readyState > ReadyState.INITIAL) {
      return
    }

    this._readyState = ReadyState.CONNECTING

    if (this._listener) {
      const wss = this._wss = new (this.WebSocketServer)({ port: this._listener.port })
      this._incomingWs = undefined

      wss.on('connection', (socket: WebSocket) => {
        this._log.info('got connection')
        let authPacket: BtpPacket

        socket.on('close', (code: number) => {
          this._log.info('incoming websocket closed. code=' + code)
          this._emitDisconnect()
        })

        socket.on('error', (err: Error) => {
          this._log.debug('incoming websocket error. error=', err)
          this._emitDisconnect()
        })

        socket.once('message', async (binaryAuthMessage: WebSocket.Data) => {
          try {
            authPacket = BtpPacket.deserialize(binaryAuthMessage)
            this._log.trace('got auth packet. packet=%j', authPacket)
            this._validateAuthPacket(authPacket)
            if (this._incomingWs) {
              this._closeIncomingSocket(this._incomingWs, authPacket)
            }
            this._incomingWs = socket
            socket.send(BtpPacket.serializeResponse(authPacket.requestId, []))
          } catch (err) {
            this._incomingWs = undefined
            if (authPacket) {
              const errorResponse = BtpPacket.serializeError({
                code: 'F00',
                name: 'NotAcceptedError',
                data: err.message,
                triggeredAt: new Date().toISOString()
              }, authPacket.requestId, [])
              socket.send(errorResponse)
            }
            socket.close()
            return
          }

          this._log.trace('connection authenticated')
          socket.on('message', this._handleIncomingWsMessage.bind(this, socket))
          this._emitConnect()
        })
      })
      this._log.info(`listening for BTP connections on ${this._listener.port}`)
    }

    if (this._server) {
      const parsedBtpUri = new URL(this._server)
      const account = parsedBtpUri.username
      const token = parsedBtpUri.password

      if (!parsedBtpUri.protocol.startsWith('btp+')) {
        throw new Error('server must start with "btp+". server=' + this._server)
      }

      this._ws = new WebSocketReconnector({
        WebSocket: this.WebSocket,
        interval: this._reconnectInterval
      })

      const protocolData = [{
        protocolName: 'auth',
        contentType: BtpPacket.MIME_APPLICATION_OCTET_STREAM,
        data: Buffer.from([])
      }, {
        protocolName: 'auth_username',
        contentType: BtpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from(account, 'utf8')
      }, {
        protocolName: 'auth_token',
        contentType: BtpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from(token, 'utf8')
      }]

      this._ws.on('open', async () => {
        this._log.trace('connected to server')
        await this._call('', {
          type: BtpPacket.TYPE_MESSAGE,
          requestId: await _requestId(),
          data: { protocolData }
        })
        this._emitConnect()
      })

      // CAUTION: Do not delete the following two lines, they have the side-effect
      // of removing the 'user@pass:' part from parsedBtpUri.toString()!
      parsedBtpUri.username = ''
      parsedBtpUri.password = ''
      const wsUri = parsedBtpUri.toString().substring('btp+'.length)

      await this._ws.open(wsUri)

      this._ws.on('close', () => this._emitDisconnect())
      this._ws.on('message', this._handleIncomingWsMessage.bind(this, this._ws))
    }

    await new Promise((resolve, reject) => {
      this.once('_first_time_connect', resolve)
      this.once('disconnect', () =>
        void reject(new Error('connection aborted')))
    })

    await this._connect()

    this._readyState = ReadyState.READY_TO_EMIT
    this._emitConnect()
  }

  _closeIncomingSocket (socket: WebSocket, authPacket: BtpPacket) {
    socket.removeAllListeners()
    socket.once('message', async (data: WebSocket.Data) => {
      try {
        socket.send(BtpPacket.serializeError({
          code: 'F00',
          name: 'NotAcceptedError',
          data: 'This connection has been ended because the user has opened a new connection',
          triggeredAt: new Date().toISOString()
        }, authPacket.requestId, []))
      } catch (e) {
        this._log.error('error responding on closed socket', e)
      }
      socket.close()
    })
  }

  async disconnect () {
    this._emitDisconnect()

    await this._disconnect()

    if (this._ws) this._ws.close()
    if (this._incomingWs) {
      this._incomingWs.close()
      this._incomingWs = undefined
    }
    if (this._wss) this._wss.close()
  }

  isConnected () {
    return this._readyState === ReadyState.CONNECTED
  }

  async _handleIncomingWsMessage (ws: WebSocket, binaryMessage: WebSocket.Data) {
    let btpPacket: BtpPacket
    try {
      btpPacket = BtpPacket.deserialize(binaryMessage)
    } catch (err) {
      this._log.error('deserialization error:', err)
      ws.close()
      return
    }

    try {
      await this._handleIncomingBtpPacket('', btpPacket)
    } catch (err) {
      this._log.debug(`Error processing BTP packet of type ${btpPacket.type}: `, err)
      const error = jsErrorToBtpError(err)
      const requestId = btpPacket.requestId
      const { code, name, triggeredAt, data } = error

      await this._handleOutgoingBtpPacket('', {
        type: BtpPacket.TYPE_ERROR,
        requestId,
        data: {
          code,
          name,
          triggeredAt,
          data,
          protocolData: []
        }
      })
    }
  }

  async sendData (buffer: Buffer): Promise<Buffer> {
    const response = await this._call('', {
      type: BtpPacket.TYPE_MESSAGE,
      requestId: await _requestId(),
      data: { protocolData: [{
        protocolName: 'ilp',
        contentType: BtpPacket.MIME_APPLICATION_OCTET_STREAM,
        data: buffer
      }] }
    })

    const ilpResponse = response.protocolData
      .filter(p => p.protocolName === 'ilp')[0]

    return ilpResponse
      ? ilpResponse.data
      : Buffer.alloc(0)
  }

  async sendMoney (amount: string): Promise<void> {
    // With no underlying ledger, sendMoney is a no-op
  }

  // don't throw errors even if the event handler throws
  // this is especially important in plugins because
  // errors can prevent the balance from being updated correctly
  _safeEmit () {
    try {
      this.emit.apply(this, arguments)
    } catch (err) {
      const errInfo = (typeof err === 'object' && err.stack) ? err.stack : String(err)
      this._log.error('error in handler for event', arguments, errInfo)
    }
  }

  registerDataHandler (handler: DataHandler) {
    if (this._dataHandler) {
      throw new Error('requestHandler is already registered')
    }

    if (typeof handler !== 'function') {
      throw new Error('requestHandler must be a function')
    }

    this._log.trace('registering data handler')
    this._dataHandler = handler
  }

  deregisterDataHandler () {
    this._dataHandler = undefined
  }

  registerMoneyHandler (handler: MoneyHandler) {
    if (this._moneyHandler) {
      throw new Error('requestHandler is already registered')
    }

    if (typeof handler !== 'function') {
      throw new Error('requestHandler must be a function')
    }

    this._log.trace('registering money handler')
    this._moneyHandler = handler
  }

  deregisterMoneyHandler () {
    this._moneyHandler = undefined
  }

  protocolDataToIlpAndCustom (packet: BtpPacketData) {
    return protocolDataToIlpAndCustom(packet)
  }

  ilpAndCustomToProtocolData (obj: { ilp?: Buffer, custom?: Object , protocolMap?: Map<string, Buffer | string | Object> }) {
    return ilpAndCustomToProtocolData(obj)
  }

  protected async _call (to: string, btpPacket: BtpPacket): Promise<BtpPacketData> {
    const requestId = btpPacket.requestId

    let callback: Listener
    let timer: NodeJS.Timer
    const response = new Promise<BtpPacketData>((resolve, reject) => {
      callback = (type: number, data: BtpPacketData) => {
        switch (type) {
          case BtpPacket.TYPE_RESPONSE:
            resolve(data)
            clearTimeout(timer)
            break

          case BtpPacket.TYPE_ERROR:
            reject(new Error(JSON.stringify(data)))
            clearTimeout(timer)
            break

          default:
            throw new Error('Unknown BTP packet type: ' + type)
        }
      }
      this.once('__callback_' + requestId, callback)
    })

    await this._handleOutgoingBtpPacket(to, btpPacket)

    const timeout = new Promise<BtpPacketData>((resolve, reject) => {
      timer = setTimeout(() => {
        this.removeListener('__callback_' + requestId, callback)
        reject(new Error(requestId + ' timed out'))
      }, this._responseTimeout)
    })

    return Promise.race([
      response,
      timeout
    ])
  }

  protected async _handleIncomingBtpPacket (from: string, btpPacket: BtpPacket) {
    const { type, requestId, data } = btpPacket
    const typeString = BtpPacket.typeToString(type)

    this._log.trace('received btp packet. type=%s requestId=%s info=%s', typeString, requestId, generatePacketDataTracer(data))
    let result: Array<BtpSubProtocol>
    switch (type) {
      case BtpPacket.TYPE_RESPONSE:
      case BtpPacket.TYPE_ERROR:
        this.emit('__callback_' + requestId, type, data)
        return
      case BtpPacket.TYPE_PREPARE:
      case BtpPacket.TYPE_FULFILL:
      case BtpPacket.TYPE_REJECT:
        throw new Error('Unsupported BTP packet')

      case BtpPacket.TYPE_TRANSFER:
        result = await this._handleMoney(from, btpPacket)
        break

      case BtpPacket.TYPE_MESSAGE:
        result = await this._handleData(from, btpPacket)
        break

      default:
        throw new Error('Unknown BTP packet type')
    }

    this._log.trace(`replying to request ${requestId} with ${JSON.stringify(result)}`)
    await this._handleOutgoingBtpPacket(from, {
      type: BtpPacket.TYPE_RESPONSE,
      requestId,
      data: { protocolData: result || [] }
    })
  }

  protected async _handleData (from: string, btpPacket: BtpPacket): Promise<Array<BtpSubProtocol>> {
    const { data } = btpPacket
    const { ilp } = protocolDataToIlpAndCustom(data)

    if (!this._dataHandler) {
      throw new Error('no request handler registered')
    }

    const response = await this._dataHandler(ilp)
    return ilpAndCustomToProtocolData({ ilp: response })
  }

  protected async _handleMoney (from: string, btpPacket: BtpPacket): Promise<Array<BtpSubProtocol>> {
    throw new Error('No sendMoney functionality is included in this module')
  }

  protected async _handleOutgoingBtpPacket (to: string, btpPacket: BtpPacket) {
    const ws = this._ws || this._incomingWs

    const { type, requestId, data } = btpPacket
    const typeString = BtpPacket.typeToString(type)
    this._log.trace('sending btp packet. type=%s requestId=%s info=%s', typeString, requestId, generatePacketDataTracer(data))

    try {
      await new Promise((resolve) => ws!.send(BtpPacket.serialize(btpPacket), resolve))
    } catch (e) {
      this._log.error('unable to send btp message to client: ' + e.message, 'btp packet:', JSON.stringify(btpPacket))
    }
  }

  private _emitDisconnect () {
    if (this._readyState !== ReadyState.DISCONNECTED) {
      this._readyState = ReadyState.DISCONNECTED
      this.emit('disconnect')
    }
  }

  private _emitConnect () {
    if (this._readyState === ReadyState.CONNECTING) {
      this.emit('_first_time_connect')
    } else if (this._readyState === ReadyState.READY_TO_EMIT || this._readyState === ReadyState.DISCONNECTED) {
      this._readyState = ReadyState.CONNECTED
      this.emit('connect')
    }
  }

  private _validateAuthPacket (authPacket: BtpPacket): void {
    assert.equal(authPacket.type, BtpPacket.TYPE_MESSAGE, 'First message sent over BTP connection must be auth packet')
    assert(authPacket.data.protocolData.length >= 2, 'Auth packet must have auth and auth_token subprotocols')
    assert.equal(authPacket.data.protocolData[0].protocolName, 'auth', 'First subprotocol must be auth')

    const tokenProto = authPacket.data.protocolData.find(
      (subProtocol) => subProtocol.protocolName === 'auth_token')
    assert(tokenProto, 'auth_token subprotocol is required')
    const token = tokenProto!.data.toString()
    if (token !== this._listener!.secret) {
      this._log.debug('received token %s, but expected %s', JSON.stringify(token), JSON.stringify(this._listener!.secret))
      throw new Error('invalid auth_token')
    }
  }
}

function _requestId (): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    crypto.randomBytes(4, (err, buf) => {
      if (err) return reject(err)
      resolve(buf.readUInt32BE(0))
    })
  })
}
