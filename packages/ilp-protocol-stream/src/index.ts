import EventEmitter3 = require('eventemitter3')
import * as ILDCP from 'ilp-protocol-ildcp'
import * as IlpPacket from 'ilp-packet'
import * as Debug from 'debug'
import * as cryptoHelper from './crypto'
import BigNumber from 'bignumber.js'
import { Duplex } from 'stream'
import {
  Frame,
  StreamMoneyFrame,
  parseFrames,
  isStreamMoneyFrame
} from './frame'
import { Reader, Writer } from 'oer-utils'
import 'source-map-support/register'

export interface Plugin {
  connect: () => Promise<void>,
  disconnect: () => Promise<void>,
  sendData: (data: Buffer) => Promise<Buffer>,
  registerDataHandler: (handler: (data: Buffer) => Promise<Buffer>) => void,
  deregisterDataHandler: () => void
}

type Stream = MoneyStream

export interface MoneyStreamOpts {
  id: number,
  isServer: boolean
}

export class MoneyStream extends EventEmitter3 {
  protected id: number
  protected debug: Debug.IDebugger
  protected isServer: boolean

  protected _amountIncoming: BigNumber
  protected _amountOutgoing: BigNumber
  protected closed: boolean

  constructor (opts: MoneyStreamOpts) {
    super()
    this.id = opts.id
    this.isServer = opts.isServer
    this.debug = Debug(`ilp-protocol-stream:Stream:${this.id}:${this.isServer ? 'Server' : 'Client'}`)

    this._amountIncoming = new BigNumber(0)
    this._amountOutgoing = new BigNumber(0)
    this.closed = false
  }

  get amountIncoming (): BigNumber {
    return new BigNumber(this._amountIncoming)
  }

  get amountOutgoing (): BigNumber {
    return new BigNumber(this._amountOutgoing)
  }

  close (): void {
    this.emit('close')
    this.closed = true
  }

  isClosed (): boolean {
    return this.closed
  }

  /**
   * Add money to the stream
   *
   * @param amount Amount to send
   */
  send(amount: BigNumber.Value): void {
    if (this.closed) {
      throw new Error('Stream already closed')
    }

    this._amountOutgoing = this._amountOutgoing.plus(amount)
    this.debug(`send: ${amount} (amountOutgoing: ${this._amountOutgoing})`)
    this.emit('_send')
  }

  /**
   * Take money out of the stream
   *
   * @param amount Amount to receive. If unspecified, it will return the full amount available
   */
  receive (amount?: BigNumber.Value): BigNumber {
    const amountToReceive = new BigNumber(amount || this._amountIncoming)

    // The user can call receive to pull money out of the stream that they previously sent,
    // in addition to money they've received from the other party
    const amountAvailable = this._amountIncoming.plus(this._amountOutgoing)
    if (amountToReceive.isGreaterThan(amountAvailable)) {
      throw new Error(`Cannot receive ${amount}, only ${amountAvailable} available`)
    }

    this._amountIncoming = this._amountIncoming.minus(amountToReceive)
    if (this._amountIncoming.isNegative()) {
      this._amountOutgoing = this._amountOutgoing.plus(this._amountIncoming)
      this._amountIncoming = new BigNumber(0)
    }

    this.debug(`receive: ${amountToReceive} (amountIncoming: ${this._amountIncoming}, amountOutgoing: ${this._amountOutgoing})`)

    return amountToReceive
  }

  /**
   * (Internal) Add money to the stream (from an external source)
   * @private
   */
  _addToIncoming (amount: BigNumber): void {
    this._amountIncoming = this._amountIncoming.plus(amount)
    this.debug(`added money to stream from external source: ${amount} (amountIncoming: ${this._amountIncoming})`)
    this.emit('incoming', amount.toString())
  }

  /**
   * (Internal) Take money out of the stream (to send to an external destination)
   * @private
   */
  _takeFromOutgoing (maxAmount?: BigNumber): BigNumber {
    const amountToReceive = (maxAmount === undefined ? this._amountOutgoing : BigNumber.minimum(maxAmount, this._amountOutgoing))
    this._amountOutgoing = this._amountOutgoing.minus(amountToReceive)
    this.emit(`sending money from stream to external destination: ${amountToReceive} (amountOutgoing: ${this._amountOutgoing})`)
    this.emit('outgoing', amountToReceive.toString())
    return amountToReceive
  }
}

export interface ConnectionOpts {
  plugin: Plugin,
  destinationAccount?: string,
  sourceAccount: string,
  sharedSecret: Buffer,
  isServer: boolean
}

export interface StreamData<Stream> {
  id: number,
  stream: Stream,
  sentOpen: boolean,
  sentClose: boolean
}

export class Connection extends EventEmitter3 {
  protected plugin: Plugin
  protected destinationAccount?: string
  protected sourceAccount: string
  protected sharedSecret: Buffer
  protected isServer: boolean

  protected moneyStreams: StreamData<MoneyStream>[]
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

    this.moneyStreams = []
    this.nextStreamId = (this.isServer ? 1 : 2)
    this.debug = Debug(`ilp-protocol-stream:Connection:${this.isServer ? 'Server' : 'Client'}`)
    this.sending = false
    this.closed = true

    this.maximumPacketAmount = new BigNumber(Infinity)

    // TODO limit total amount buffered for all streams?
  }

  createMoneyStream (): MoneyStream {
    // TODO should this inform the other side?
    const stream = new MoneyStream({
      id: this.nextStreamId,
      isServer: this.isServer
    })
    this.moneyStreams[this.nextStreamId] = {
      id: this.nextStreamId,
      stream,
      sentOpen: false,
      sentClose: false
    } as StreamData<MoneyStream>
    this.debug(`created money stream: ${this.nextStreamId}`)
    this.nextStreamId += 2

    stream.on('_send', () => this.startSendLoop())
    // TODO notify when the stream is closed

    return stream
  }

  /** @private */
  async handlePrepare (prepare: IlpPacket.IlpPrepare): Promise<IlpPacket.IlpFulfill> {
    this.debug(`got ILP Prepare:`, prepare)
    // Decrypt
    let frameData
    try {
      frameData = cryptoHelper.decrypt(this.sharedSecret, prepare.data)
    } catch (err) {
      this.debug(`error decrypting data:`, err, prepare.data.toString('hex'))
      throw new IlpPacket.Errors.UnexpectedPaymentError('')
    }

    // Ensure we can generate correct fulfillment
    const fulfillment = cryptoHelper.generateFulfillment(this.sharedSecret, prepare.data)
    const generatedCondition = cryptoHelper.hash(fulfillment)
    if (!generatedCondition.equals(prepare.executionCondition)) {
      this.debug(`generated a different condition than the prepare had. generated: ${generatedCondition.toString('hex')}, prepare condition: ${prepare.executionCondition.toString('hex')}`)
      throw new IlpPacket.Errors.WrongConditionError('')
    }

    // Parse frames
    let frames
    try {
      frames = parseFrames(frameData)
    } catch (err) {
      this.debug(`error parsing frames:`, err)
      throw new IlpPacket.Errors.UnexpectedPaymentError('')
    }

    // Make sure prepare amount >= sum of stream frame amounts

    // Handle control frames

    // Pass stream frames to relevant stream (and make sure the amount and data don't exceed the stream's buffers)
    // Emit 'stream' event for new streams
    for (let frame of frames) {
      if (isStreamMoneyFrame(frame)) {
        const streamId = frame.streamId.toNumber()

        // Handle new incoming MoneyStreams
        if (!this.moneyStreams[streamId]) {
          this.debug(`got new money stream: ${streamId}`)
          const stream = new MoneyStream({
            id: streamId,
            isServer: this.isServer
          })
          this.moneyStreams[streamId] = {
            id: streamId,
            stream,
            sentOpen: true,
            sentClose: false
          } as StreamData<MoneyStream>

          this.emit('money_stream', stream)
          stream.on('_send', () => this.startSendLoop())

          // Handle the new frame on the next tick of the event loop
          // to wait for event handlers that may be added to the new stream
          await new Promise((resolve, reject) => setImmediate(resolve))
        }

        // TODO check that all of the streams are able to receive the amount of money before accepting any of them
        this.moneyStreams[streamId].stream._addToIncoming(frame.amount)
      } else {
        this.debug(`got unexpected frame type: ${frame.type}`)
        throw new IlpPacket.Errors.UnexpectedPaymentError('')
      }
    }

    // Fill up response data with data frames
    const data = Buffer.alloc(0)

    this.debug(`fulfilling prepare with fulfillment: ${fulfillment.toString('hex')}`)

    // Return fulfillment
    return {
      fulfillment,
      data
    }
  }

  protected async startSendLoop () {
    if (this.sending) {
      this.debug('already sending, not starting another loop')
      return
    }
    this.sending = true

    while (this.sending) {
      // Send multiple packets at the same time (don't await promise)
      await this.sendPacket()

      // Figure out if we need to wait before sending the next one
    }
  }

  protected async sendPacket (): Promise<void> {
    this.debug('sendPacket')
    let amountToSend = new BigNumber(0)
    const frames: Frame[] = []

    if (!this.destinationAccount) {
      this.debug('not sending because we do not know the client\'s address')
      return
    }

    // Determine how much to send based on amount frames and path maximum packet amount
    let maxAmountFromStream = this.maximumPacketAmount
    for (let msRecord of this.moneyStreams) {
      if (!msRecord || msRecord.sentClose) {
        // TODO just remove closed streams?
        continue
      }

      const amountToSendFromStream = msRecord.stream._takeFromOutgoing(maxAmountFromStream)
      if (amountToSendFromStream.isEqualTo(0)) {
        continue
      }

      const isEnd = msRecord.stream.isClosed() && msRecord.stream.amountOutgoing.isEqualTo(0)
      const frame = new StreamMoneyFrame(msRecord.id, amountToSendFromStream, isEnd)
      // TODO make sure the length of the frame's doesn't exceed packet data limit
      frames.push(frame)
      amountToSend = amountToSend.plus(amountToSendFromStream)
      maxAmountFromStream = maxAmountFromStream.minus(amountToSendFromStream)

      msRecord.sentClose = isEnd || msRecord.sentClose

      if (maxAmountFromStream.isEqualTo(0)) {
        break
      }
    }

    if (amountToSend.isEqualTo(0)) {
      this.sending = false
    }

    // Load packet data with available data frames (keep track of max data length)
    // TODO implement sending data

    // Encrypt
    const dataWriter = new Writer()
    for (let frame of frames) {
      frame.writeTo(dataWriter)
    }
    const encodedFrames = dataWriter.getBuffer()
    const data = cryptoHelper.encrypt(this.sharedSecret, encodedFrames)

    // Generate condition
    const fulfillment = cryptoHelper.generateFulfillment(this.sharedSecret, data)
    const executionCondition = cryptoHelper.hash(fulfillment)

    // Send
    const prepare = {
      destination: this.destinationAccount,
      amount: amountToSend.toString(),
      data,
      executionCondition,
      // TODO more intelligent expiry
      expiresAt: new Date(Date.now() + 30000)
    }
    this.debug(`sending prepare: ${JSON.stringify(prepare)}`)
    const response = await this.plugin.sendData(IlpPacket.serializeIlpPrepare(prepare))

    let packet: IlpPacket.IlpFulfill | IlpPacket.IlpRejection
    try {
      if (response[0] === IlpPacket.Type.TYPE_ILP_FULFILL) {
        packet = IlpPacket.deserializeIlpFulfill(response)
      } else if (response[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
        packet = IlpPacket.deserializeIlpReject(response)
      } else {
        throw new Error(`Invalid response packet type: ${response[0]}`)
      }
    } catch (err) {
      this.debug(`got invalid response from sendData:`, err, response.toString('hex'))
      this.emit('error', new Error(`Invalid response when sending packet: ${err.message}`))
    }

    // TODO prevent replay attacks -- make sure response corresponds to request

    // Handle errors (shift the frames back into the queue)
  }
}

export interface CreateConnectionOpts {
  plugin: Plugin,
  destinationAccount: string,
  sharedSecret: Buffer
}

export async function createConnection (opts: CreateConnectionOpts): Promise<Connection> {
  await opts.plugin.connect()
  const sourceAccount = (await ILDCP.fetch(opts.plugin.sendData.bind(opts.plugin))).clientAddress
  const connection = new Connection({
    plugin: opts.plugin,
    destinationAccount: opts.destinationAccount,
    sourceAccount,
    sharedSecret: opts.sharedSecret,
    isServer: false
  })
  // TODO resolve only when it is connected
  return connection
}

export interface ServerOpts {
  serverSecret: Buffer,
  plugin: Plugin
}

export class Server extends EventEmitter3 {
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
    this.connections = {}
  }

  async listen (): Promise<void> {
    this.plugin.registerDataHandler(this.handleData.bind(this))
    await this.plugin.connect()
    this.sourceAccount = (await ILDCP.fetch(this.plugin.sendData.bind(this.plugin))).clientAddress
  }

  generateAddressAndSecret (): { destinationAccount: string, sharedSecret: Buffer } {
    const { token, sharedSecret } = cryptoHelper.generateTokenAndSharedSecret(this.serverSecret)
    return {
      destinationAccount: `${this.sourceAccount}.${base64url(token)}`,
      sharedSecret
    }
  }

  protected async handleData (data: Buffer): Promise<Buffer> {
    try {
      let prepare: IlpPacket.IlpPrepare
      try {
        prepare = IlpPacket.deserializeIlpPrepare(data)
      } catch (err) {
        this.debug(`got data that is not an ILP Prepare packet: ${data.toString('hex')}`)
        throw new IlpPacket.Errors.BadRequestError('Expected an ILP Prepare packet')
      }

      const localAddressParts = prepare.destination.replace(this.sourceAccount + '.', '').split('.')
      if (localAddressParts.length === 0 || !localAddressParts[0]) {
        this.debug(`destination in ILP Prepare packet does not have a Connection ID: ${prepare.destination}`)
        throw new IlpPacket.Errors.UnreachableError('')
      }
      const connectionId = localAddressParts[0]

      if (!this.connections[connectionId]) {
        try {
          const token = Buffer.from(connectionId, 'base64')
          const sharedSecret = cryptoHelper.generateSharedSecretFromToken(this.serverSecret, token)
          cryptoHelper.decrypt(sharedSecret, prepare.data)

          // If we get here, that means it was a token + sharedSecret we created
          const connection = new Connection({
            plugin: this.plugin,
            sourceAccount: this.sourceAccount,
            sharedSecret,
            isServer: true
          })
          this.connections[connectionId] = connection
          this.debug(`got incoming packet for new connection: ${connectionId}`)
          this.emit('connection', connection)

          // Wait for the next tick of the event loop before handling the prepare
          await new Promise((resolve, reject) => setImmediate(resolve))
        } catch (err) {
          this.debug(`got prepare for an address and token that we did not generate: ${prepare.destination}`)
          throw new IlpPacket.Errors.UnreachableError('')
        }
      }

      const fulfill = await this.connections[connectionId].handlePrepare(prepare)
      return IlpPacket.serializeIlpFulfill(fulfill)

    } catch (err) {
      // TODO should the default be F00 or T00?
      this.debug('error handling prepare:', err)
      return IlpPacket.serializeIlpReject({
        code: err.ilpErrorCode || 'F00',
        message: err.ilpErrorMessage || '',
        data: err.ilpErrorData || Buffer.alloc(0),
        triggeredBy: this.sourceAccount
      })
    }
  }
}

function base64url (buffer: Buffer) {
  return buffer.toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}