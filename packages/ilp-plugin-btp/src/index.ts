import * as assert from 'assert'
import * as crypto from 'crypto'
import * as Debug from 'debug'
import * as WebSocket from 'ws'
import { WebSocketReconnector, WebSocketConstructor } from './ws-reconnect'
import { EventEmitter2, Listener } from 'eventemitter2'
import { URL } from 'url'
import { protocolDataToIlpAndCustom, ilpAndCustomToProtocolData } from './protocol-data-converter'

const BtpPacket = require('btp-packet')

const debug = require('ilp-logger')('ilp-plugin-btp')

type DataHandler = (data: Buffer) => Promise<Buffer>
type MoneyHandler = (amount: string) => Promise<void>

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
  'TransferNotFoundError': 'F03',
  'InvalidFulfillmentError': 'F04',
  'DuplicateIdError': 'F05',
  'AlreadyRolledBackError': 'F06',
  'AlreadyFulfilledError': 'F07',
  'InsufficientBalanceError': 'F08'
}

/**
 * Returns BTP error code as defined by the BTP ASN.1 spec.
 */
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

/**
 * Converts BTP sub protocol data from json/plain text/octet stream to string.
 */
function subProtocolToString (data: BtpSubProtocol): string {
  let stringData

  switch (data.contentType) {
    case BtpPacket.MIME_APPLICATION_OCTET_STREAM:
      stringData = data.data.toString('base64')
      break
    case BtpPacket.MIME_APPLICATION_JSON:
    case BtpPacket.MIME_TEXT_PLAIN_UTF8:
      stringData = data.data.toString('utf8')
      break
  }

  return `${data.protocolName}=${stringData}`
}

/**
 * Goes through all the sub protocols in the packet data of a BTP packet and
 * returns a protocol map of each sub protocol with the key as the protocol
 * name and value as a string-form protocol object. Calls
 * `subProtocolToString(data)` to convert the value to a string.
 */
function generatePacketDataTracer (packetData: BtpPacketData) {
  return {
    toString: () => {
      try {
        return packetData.protocolData.map(data => {
          switch (data.protocolName) {
            case 'ilp':
              return ILP_PACKET_TYPES[data.data[0]] || ('ilp-' + data.data[0])
            default:
              return subProtocolToString(data)
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

/**
 * Constructor options for a BTP plugin. The 'Instance Management' section of
 * the RFC-24 indicates that every ledger plugin accepts an opts object, and
 * an optional api denoted as 'PluginServices.' This is the opts object.
 */
export interface IlpPluginBtpConstructorOptions {
  server?: string,
  listener?: {
    port: number,
    secret: string
  },
  reconnectInterval?: number
  reconnectIntervals?: Array<number>
  reconnectClearTryTimeout?: number
  responseTimeout?: number
  btpAccount?: string
  btpToken?: string
}

export interface WebSocketServerConstructor {
  new (opts: WebSocket.ServerOptions): WebSocket.Server
}

/**
 * This is the optional api, or 'PluginServices' interface, that is passed
 * into the ledger plugin constructor as defined in RFC-24. In this case
 * the api exposes 3 modules.
 */
export interface IlpPluginBtpConstructorModules {
  log?: any
  WebSocket?: WebSocketConstructor
  WebSocketServer?: WebSocketServerConstructor
}

/**
 * Abstract base class for building BTP-based ledger plugins.
 *
 * This class takes care of most of the work translating between BTP and the
 * ledger plugin interface (LPI).
 *
 * You need to implement:
 *
 * `sendMoney (amount)`, handleMoney `(from, btpPacket)`
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
  private _reconnectIntervals?: Array<number>
  private _reconnectClearTryTimeout?: number
  private _responseTimeout: number

  protected _dataHandler?: DataHandler
  protected _moneyHandler?: MoneyHandler
  private _readyState: ReadyState = ReadyState.INITIAL
  protected _log: any
  private WebSocket: WebSocketConstructor
  private WebSocketServer: WebSocketServerConstructor

  /**
   * Specify for a BTP instance that is acting as a server.
   */
  private _listener?: {
    port: number,
    secret: string
  }
  protected _wss: WebSocket.Server | null = null
  private _incomingWs?: WebSocket

  /**
   * Specify for a BTP instance that is acting as a client.
   */
  private _server?: string
  private _btpToken?: string
  private _btpAccount?: string

  /**
   * Refer to `ws-reconnect` module.
   */
  private _ws?: WebSocketReconnector

  constructor (options: IlpPluginBtpConstructorOptions, modules?: IlpPluginBtpConstructorModules) {
    super()

    this._reconnectInterval = options.reconnectInterval // optional
    this._reconnectIntervals = options.reconnectIntervals // optional
    this._reconnectClearTryTimeout = options.reconnectClearTryTimeout // optional
    this._responseTimeout = options.responseTimeout || DEFAULT_TIMEOUT
    this._listener = options.listener
    this._server = options.server

    if (this._server) {
      const parsedBtpUri = new URL(this._server)
      const parsedAccount = parsedBtpUri.username
      const parsedToken = parsedBtpUri.password

      if (!parsedBtpUri.protocol.startsWith('btp+')) {
        throw new Error('server must start with "btp+". server=' + this._server)
      }

      if ((parsedAccount || parsedToken) && (options.btpAccount || options.btpToken)) {
        throw new Error('account/token must be passed in via constructor or uri, but not both')
      }

      this._btpToken = parsedToken || options.btpToken || ''
      this._btpAccount = parsedAccount || options.btpAccount || ''
    }

    modules = modules || {}
    this._log = modules.log || debug
    this._log.trace = this._log.trace || Debug(this._log.debug.namespace + ':trace')
    this.WebSocket = modules.WebSocket || WebSocket
    this.WebSocketServer = modules.WebSocketServer || WebSocket.Server
  }

  // Required for different _connect signature in mini-accounts and its subclasses
  /* tslint:disable-next-line:no-empty */
  protected async _connect (...opts: any[]): Promise<void> {}
  /* tslint:disable-next-line:no-empty */
  protected async _disconnect (): Promise<void> {}

  /**
   * Connect to another BTP-based ledger plugin if the instance is not already
   * connected/connecting to another plugin.
   *
   * **If the BTP instance is acting as a server:**
   *
   * It creates a new server on the specified `port` from `this.listener`.
   * It creates an event listener for `connection`. When a connection
   * is established, listeners for `close`, `error`, and `message` are
   * added. The listeners for close and error call `emitDisconnect()`.
   *
   * There are two listeners for `message` events. First:
   * Uses socket.once to add a one time listener for the event. The
   * listener is only invoked the first time and then removed. This is
   * because the auth message only needs to occur once. We do not want
   * this event to be triggered on subsequent messages.
   *
   * Call `validateAuthPacket()`, and close any other incoming
   * websocket connections (if present) by calling `closeIncomingSocket`. Return a
   * response containing the request id if the auth packet is valid.
   *
   * Otherwise, if an auth packet fails validation, return a BTP error
   * response over the connection and close.
   *
   * Finally, add a listener to accept subsequent incoming websocket
   * messages and handle them accordingly. Calls
   * `handleIncomingWsMessage(socket)`.
   *
   * **If the BTP instance is acting as a client:**
   *
   * Generate the BTP URL with username, token, and the server uri.
   * Register listener for opening connection, first time connect, and
   * incoming messages. Need to register the on open listener before actually
   * opening a connection. The reason this is not a 'once' listener is
   * because the client might have to reconnect if the connection fails (as
   * specified in ws-reconnect) and thus the listener must be active. The `open`
   * listener sends the BTP auth packet to the server using the `call` function
   * (sends request, sets a timeout to wait for response).
   *
   * Open the connection, and register listeners for `close`, `message`. If the
   * connection is successfully established, resolve. Otherwise if
   * closed/disconnected error.
   *
   * **Important:** now call `this._connect()` which will be overriden in
   * subsequent plugins to add ledger functionality after the connection has
   * been established.
   */
  async connect () {
    if (this._readyState > ReadyState.INITIAL) {
      return
    }

    this._readyState = ReadyState.CONNECTING

    /* Server logic. */
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

    /* Client logic. */
    if (this._server) {
      const parsedBtpUri = new URL(this._server)
      const account = this._btpAccount || ''
      const token = this._btpToken || ''

      this._ws = new WebSocketReconnector({
        WebSocket: this.WebSocket,
        intervals: this._reconnectIntervals,
        interval: this._reconnectInterval,
        clearTryTimeout: this._reconnectClearTryTimeout
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
        this._call('', {
          type: BtpPacket.TYPE_MESSAGE,
          requestId: await _requestId(),
          data: { protocolData }
        }).then(() => {
          this._emitConnect()
        }).catch((err) => {
          this._log.error('error authenticating btp connection', err.message)
        })
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
      const onDisconnect = () => {
        if (this._ws) this._ws.close()
        reject(new Error('connection aborted'))
      }
      this.once('disconnect', onDisconnect)
      this.once('_first_time_connect', () => {
        this.removeListener('disconnect', onDisconnect)
        resolve()
      })
    })

    /* To be overriden. */
    await this._connect()

    this._readyState = ReadyState.READY_TO_EMIT
    this._emitConnect()
  }

  /**
   * For when there is an existing websocket connection and a new
   * connection is opened. Removes all listeners from previous connection and
   * sends an error to the user on the old socket (with the new request ID).
   */
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

  /**
   * Close client/server and emit disconnect.
   *
   * **Important**: calls `this_disconnect` which is meant to be overriden by
   * plugins that extend BTP to add additional (e.g. ledger) functionality on
   * disconnect.
   */
  async disconnect () {
    this._emitDisconnect()

    /* To be overriden. */
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

  /**
   * Deserialize incoming websocket message and call `handleIncomingBtpPacket`.
   * If error in handling btp packet, call `handleOutgoingBtpPacket` and send
   * the error through the socket.
   */
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

  /**
   * Send Btp data to counterparty. Uses `_call` which sets the proper timer for
   * expiry on response packets.
   */
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

  /**
   * With no underlying ledger, sendMoney is a no-op.
   */
  async sendMoney (amount: string): Promise<void> {
    /* NO OP */
  }

  /**
   * Don't throw errors even if the event handler throws
   * this is especially important in plugins because
   * errors can prevent the balance from being updated correctly.
   */
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

    // TODO Is this check required? TypeScript's linter suggests not
    // tslint:disable-next-line:strict-type-predicates
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

    // TODO Is this check required? TypeScript's linter suggests not
    // tslint:disable-next-line:strict-type-predicates
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

  /**
   * Converts protocol map to Btp packet. Reference in
   * procotol-data-converter.ts.
   */
  ilpAndCustomToProtocolData (obj: { ilp?: Buffer, custom?: Object , protocolMap?: Map<string, Buffer | string | Object> }) {
    return ilpAndCustomToProtocolData(obj)
  }

  /**
   * Function to send Btp requests with proper timeout for response or error.
   *
   * Create a listener for for an incoming Btp response/error. Resolves on
   * btp response, rejects on btp error. Send an outgoing btp packet (request),
   * and set a timer. If the timer expires before a response/error is received, time
   * out. If a response/error is received, `_handleIncomingBtpPacket` emits
   * `__callback__`, which triggers the aforementioned listener.
   */
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

  /**
   * If a response or error packet is received, trigger the callback function
   * defined in _call (i.e. response/error returned before timing out)
   * function. Throw error on PREPARE, FULFILL or REJECT packets, because they
   * are not BTP packets. If TRANSFER or MESSAGE packets are received, invoke
   * money handler or data handler respectively. Otherwise prepare a response and handle the outgoing BTP
   * packet. The reason this function does not handle sending back an ERROR
   * packet in the websocket is because that is defined in the
   * _handleIncomingWsMessage function.
   */
  protected async _handleIncomingBtpPacket (from: string, btpPacket: BtpPacket) {
    const { type, requestId, data } = btpPacket
    const typeString = BtpPacket.typeToString(type)

    this._log.trace(`received btp packet. type=${typeString} requestId=${requestId} info=${generatePacketDataTracer(data)}`)
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

    await this._handleOutgoingBtpPacket(from, {
      type: BtpPacket.TYPE_RESPONSE,
      requestId,
      data: { protocolData: result || [] }
    })
  }

  /**
   * Called after receiving btp packet of type message. First convert it to ILP
   * format, then handle the ILP data with the regsistered data handler, and then convert it back to BTP
   * structure and send a response. E.g. for prepare, fulfill, and reject packets.
   */
  protected async _handleData (from: string, btpPacket: BtpPacket): Promise<Array<BtpSubProtocol>> {
    const { data } = btpPacket
    const { ilp } = protocolDataToIlpAndCustom(data) /* Defined in protocol-data-converter.ts. */

    if (!this._dataHandler) {
      throw new Error('no request handler registered')
    }

    const response = await this._dataHandler(ilp)
    return ilpAndCustomToProtocolData({ ilp: response })
  }

  /**
   * Need to fully define on you own.
   */
  protected async _handleMoney (from: string, btpPacket: BtpPacket): Promise<Array<BtpSubProtocol>> {
    throw new Error('No sendMoney functionality is included in this module')
  }

  /**
   * Send a BTP packet to a user and wait for the promise to resolve without
   * error.
   */
  protected async _handleOutgoingBtpPacket (to: string, btpPacket: BtpPacket) {
    const ws = this._ws || this._incomingWs

    const { type, requestId, data } = btpPacket
    const typeString = BtpPacket.typeToString(type)
    this._log.trace(`sending btp packet. type=${typeString} requestId=${requestId} info=${generatePacketDataTracer(data)}`)

    try {
      await new Promise((resolve) => ws!.send(BtpPacket.serialize(btpPacket), resolve))
    } catch (e) {
      this._log.error('unable to send btp message to client: ' + e.message, 'btp packet:', JSON.stringify(btpPacket))
    }
  }

  /**
   * If the instance is not already disconnected, change the ReadyState and
   * emit a disconnect event.
   */
  private _emitDisconnect () {
    if (this._readyState !== ReadyState.DISCONNECTED) {
      this._readyState = ReadyState.DISCONNECTED
      this.emit('disconnect')
    }
  }

  /**
   * If the ReadyState is CONNECTING it implies a first time connect, so
   * accordingly emit that message. Otherwise if the instance has already
   * registered listeners (i.e. connected before) and is in the appropriate
   * ready state then emit a normal 'connect' event.
   */
  private _emitConnect () {
    if (this._readyState === ReadyState.CONNECTING) {
      this.emit('_first_time_connect')
    } else if (this._readyState === ReadyState.READY_TO_EMIT || this._readyState === ReadyState.DISCONNECTED) {
      this._readyState = ReadyState.CONNECTED
      this.emit('connect')
    }
  }

  /**
   * Make sure the auth packet is structured correctly with both an 'auth'
   * subprotocol and an 'auth token' subprotocol. The auth token needs to match the
   * secret defined by the server (which should have been given to the client
   * beforehand.) If the auth token does not pass any of these checks, error.
   */
  private _validateAuthPacket (authPacket: BtpPacket): void {
    assert.strictEqual(authPacket.type, BtpPacket.TYPE_MESSAGE, 'First message sent over BTP connection must be auth packet')
    assert(authPacket.data.protocolData.length >= 2, 'Auth packet must have auth and auth_token subprotocols')
    assert.strictEqual(authPacket.data.protocolData[0].protocolName, 'auth', 'First subprotocol must be auth')

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

/**
 * Generate a new request id.
 */
function _requestId (): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    crypto.randomBytes(4, (err, buf) => {
      if (err) return reject(err)
      resolve(buf.readUInt32BE(0))
    })
  })
}
