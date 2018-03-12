import { default as EventEmitter } from 'eventemitter3'
import * as ILDCP from 'ilp-protocol-ildcp'
import {
  IlpPrepare,
  IlpFulfill,
  IlpRejection,
  Errors,
  serializeIlpPrepare,
  serializeIlpFulfill,
  serializeIlpReject,
  deserializeIlpPrepare,
  deserializeIlpFulfill,
  deserializeIlpReject
} from 'ilp-packet'
import * as Debug from 'debug'
import * as crypto from 'crypto'
import BigNumber from 'bignumber.js'
import { Duplex } from 'stream'

const TOKEN_LENGTH = 18
const SHARED_SECRET_GENERATION_STRING = 'ilp_stream_shared_secret'

export interface Plugin {
  connect: () => Promise<void>,
  disconnect: () => Promise<void>,
  sendData: (data: Buffer) => Promise<Buffer>,
  registerDataHandler: (handler: (data: Buffer) => Promise<Buffer>) => void,
  deregisterDataHandler: () => void
}

export interface StreamOpts {
  id: number,
  connection: Connection,
  maxBufferAmount: BigNumber,
  isServer: boolean
}

export class Stream extends Duplex {
  readonly id: number
  protected connection: Connection
  protected amountSent: BigNumber
  protected amountReceived: BigNumber
  protected amountUsed: BigNumber
  protected amountBufferMax: BigNumber
  protected finished: boolean
  protected debug: Debug.IDebugger
  protected isServer: boolean

  constructor (opts: StreamOpts) {
    super()

    this.id = opts.id
    this.connection = opts.connection
    this.amountBufferMax = opts.maxBufferAmount
    this.isServer = opts.isServer

    this.debug = Debug(`ilp-protocol-stream:Stream:${this.id}:${this.isServer ? 'Server' : 'Client'}`)
    this.amountSent = new BigNumber(0)
    this.amountReceived = new BigNumber(0)
    this.amountUsed = new BigNumber(0)
    this.finished = false
  }

  sendMoney (amount: BigNumber.Value): void {
    if (this.finished) {
      throw new Error('Stream already closed')
    }

  }

  receiveMoney (amount?: BigNumber.Value): string {
    // TODO adjust the limit and let the peer know if we don't have enough
    const available = this.amountReceived.minus(this.amountUsed)
    const amountToUse = BigNumber.minimum(amount, available)
    this.amountUsed = this.amountUsed.plus(amountToUse)
    return amountToUse.toString()
  }

  protected _flushData () {

  }

  _read (size: number) {

  }

  _write (chunk: Buffer, encoding: string, callback: (...args: any[]) => void): void {

  }

  _final (callback: (...args: any[]) => void): void {

  }
}

export interface ConnectionOpts {
  plugin: Plugin,
  destinationAccount: string,
  sourceAccount: string,
  sharedSecret: Buffer,
  isServer: boolean

}

export class Connection extends EventEmitter {
  protected plugin: Plugin
  protected destinationAccount: string
  protected sourceAccount: string
  protected sharedSecret: Buffer
  protected isServer: boolean
  protected streams: Stream[]
  protected nextStreamId: number
  protected debug: Debug.IDebugger
  protected sending: boolean
  protected maximumPacketAmount: BigNumber
  protected closed: boolean

  constructor (opts: ConnectionOpts) {
    super()
    this.plugin = opts.plugin
    this.destinationAccount = opts.destinationAccount
    this.sourceAccount = opts.sourceAccount
    this.sharedSecret = opts.sharedSecret
    this.isServer = opts.isServer
    this.streams = []
    this.nextStreamId = (this.isServer ? 1 : 2)
    this.debug = Debug(`ilp-protocol-stream:Connection:${this.isServer ? 'Server' : 'Client'}`)
    this.sending = false
    this.closed = true

    // TODO limit total amount buffered for all streams?
  }

  createStream (): Stream {
    // TODO should this inform the other side?
    const stream = new Stream({
      id: this.nextStreamId,
      connection: this,
      maxBufferAmount: new BigNumber(0),
      isServer: this.isServer
    })
    this.streams[this.nextStreamId] = stream
    this.debug(`created stream: ${this.nextStreamId}`)
    this.nextStreamId += 2
    return stream
  }

  _sendAmountFrame (frame: StreamAmountFrame): void {

  }

  _sendDataFrame (frame: DataFrame): void {

  }

  /** @private */
  async handlePrepare (ilpPacket: IlpPrepare): Promise<IlpFulfill> {
    // Decrypt

    // Ensure we can generate correct fulfillment

    // Make sure prepare amount >= sum of stream frame amounts

    // Handle control frames

    // Pass stream frames to relevant stream (and make sure the amount and data don't exceed the stream's buffers)
    // Emit 'stream' event for new streams

    // Fill up response data with data frames

    // Return fulfillment
  }

  protected startSendLoop () {
    if (this.sending) {
      this.debug('already sending, not starting another loop')
      return
    }
    this.sending = true

    while (this.sending) {
      // Send multiple packets at the same time (don't await promise)
      this.sendPacket()

      // Figure out if we need to wait before sending the next one
    }
  }

  protected async sendPacket (): Promise<void> {
    // Determine how much to send based on amount frames and path maximum packet amount

    // Load packet data with amount frames

    // Load packet data with available data frames (keep track of max data length)

    // Encrypt

    // Send

    // Handle errors (shift the frames back into the queue)

  }
}

export interface ServerOpts {
  serverSecret: Buffer,
  plugin: Plugin
}

export class Server extends EventEmitter {
  protected serverSecret: Buffer
  protected plugin: Plugin
  protected sourceAccount: string
  protected connections: { [key: string]: Connection }
  protected debug: Debug.IDebugger

  constructor (opts: ServerOpts) {
    super()
    this.serverSecret = opts.serverSecret
    this.plugin = opts.plugin
    this.debug = Debug('ilp-protocol-stream:Server')
  }

  async listen (): Promise<void> {
    this.plugin.registerDataHandler(this.handleData.bind(this))
    await this.plugin.connect()
    this.sourceAccount = (await ILDCP.fetch(this.plugin.sendData)).clientAddress
  }

  generateAddressAndSecret (): { destinationAccount: string, sharedSecret: Buffer } {
    const token = crypto.randomBytes(TOKEN_LENGTH)
    const keygen = hmac(this.serverSecret, SHARED_SECRET_GENERATION_STRING)
    const sharedSecret = hmac(keygen, token)
    return {
      destinationAccount: `${this.sourceAccount}.${base64url(token)}`,
      sharedSecret
    }
  }

  protected async handleData (data: Buffer): Promise<Buffer> {
    try {
      let prepare: IlpPrepare
      try {
        prepare = deserializeIlpPrepare(data)
      } catch (err) {
        this.debug(`got data that is not an ILP Prepare packet: ${data.toString('hex')}`)
        throw new Errors.BadRequestError('Expected an ILP Prepare packet')
      }

      const localAddressParts = prepare.destination.replace(this.sourceAccount, '').split('.')
      if (localAddressParts.length === 0) {
        this.debug(`destination in ILP Prepare packet does not have a Connection ID: ${prepare.destination}`)
        throw new Errors.UnreachableError('')
      }
      const connectionId = localAddressParts[0]

      if (!this.connections[connectionId]) {
        // TODO try decrypting to see if it's just a new connection

        this.debug(`no connection with ID: ${connectionId}`)
        throw new Errors.UnreachableError('')
      }

      const fulfill = await this.connections[connectionId].handlePrepare(prepare)
      return serializeIlpFulfill(fulfill)

    } catch (err) {
      // TODO should the default be F00 or T00?
      return serializeIlpReject({
        code: err.ilpErrorCode || 'F00',
        message: err.ilpErrorMessage || '',
        data: err.ilpErrorData || Buffer.alloc(0),
        triggeredBy: this.sourceAccount
      })
    }
  }
}

function hmac (key: string | Buffer, message: string | Buffer): Buffer {
  const h = crypto.createHmac('sha256', key)
  h.update(message)
  return h.digest()
}

function base64url (buffer: Buffer) {
  return buffer.toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}