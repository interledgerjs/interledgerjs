import EventEmitter3 = require('eventemitter3')
import * as Debug from 'debug'
import { DataAndMoneyStream } from './stream'
import * as IlpPacket from 'ilp-packet'
import * as cryptoHelper from './crypto'
import {
  Packet,
  Frame,
  StreamMoneyFrame,
  StreamMoneyErrorFrame,
  StreamDataFrame,
  StreamMoneyMaxFrame,
  FrameType,
  IlpPacketType,
  ConnectionNewAddressFrame,
  ErrorCode,
  ConnectionErrorFrame,
  ApplicationErrorFrame,
  ConnectionStreamIdBlockedFrame,
  ConnectionMaxStreamIdFrame
} from './protocol'
import { Reader } from 'oer-utils'
import { Plugin } from './types'
import BigNumber from 'bignumber.js'
import { RemoteConnection, RemoteStream, ByteSegment } from './remote'
require('source-map-support').install()

const TEST_PACKET_AMOUNT = new BigNumber(1000)
const RETRY_DELAY_START = 100
const MAX_DATA_SIZE = 32767
export const DEFAULT_MAX_REMOTE_STREAMS = 10

export interface ConnectionOpts {
  plugin: Plugin,
  destinationAccount?: string,
  sourceAccount?: string,
  slippage?: BigNumber.Value,
  enablePadding?: boolean,
  connectionTag?: string,
  maxRemoteStreams?: number
}

export interface FullConnectionOpts extends ConnectionOpts {
  sourceAccount: string,
  isServer: boolean,
  sharedSecret: Buffer
}

/**
 * The ILP STREAM connection between client and server.
 *
 * A single connection can be used to send or receive on multiple streams.
 */
export class Connection extends EventEmitter3 {
  /** Application identifier for a certain connection */
  readonly connectionTag?: string
  protected plugin: Plugin
  protected sourceAccount: string
  protected sharedSecret: Buffer
  protected isServer: boolean
  protected slippage: BigNumber
  protected allowableReceiveExtra: BigNumber
  protected enablePadding: boolean

  protected nextPacketSequence: number
  protected streams: DataAndMoneyStream[]
  protected nextStreamId: number
  protected maxStreamId: number
  protected debug: Debug.IDebugger
  protected sending: boolean
  /** Used to probe for the Maximum Packet Amount if the connectors don't tell us directly */
  protected testMaximumPacketAmount: BigNumber
  /** The path's Maximum Packet Amount, discovered through F08 errors */
  protected maximumPacketAmount: BigNumber
  protected closed: boolean
  protected exchangeRate?: BigNumber
  protected retryDelay: number
  protected queuedFrames: Frame[]

  protected remoteConnection: RemoteConnection

  constructor (opts: FullConnectionOpts) {
    super()
    this.plugin = opts.plugin
    this.sourceAccount = opts.sourceAccount
    this.sharedSecret = opts.sharedSecret
    this.isServer = opts.isServer
    this.slippage = new BigNumber(opts.slippage || 0)
    this.allowableReceiveExtra = new BigNumber(1.01)
    this.enablePadding = !!opts.enablePadding
    this.connectionTag = opts.connectionTag
    this.maxStreamId = 2 * (opts.maxRemoteStreams || DEFAULT_MAX_REMOTE_STREAMS)

    this.nextPacketSequence = 1
    this.streams = []
    this.nextStreamId = (this.isServer ? 2 : 1)
    this.debug = Debug(`ilp-protocol-stream:${this.isServer ? 'Server' : 'Client'}:Connection`)
    this.sending = false
    this.closed = true
    this.queuedFrames = []

    this.maximumPacketAmount = new BigNumber(Infinity)
    this.testMaximumPacketAmount = new BigNumber(Infinity)
    this.retryDelay = RETRY_DELAY_START

    this.remoteConnection = new RemoteConnection()
    this.remoteConnection.sourceAccount = opts.destinationAccount
    this.remoteConnection.knowsOurAccount = this.isServer

    // TODO limit total amount buffered for all streams?
  }

  /**
   * Start sending or receiving.
   *
   * The connection will emit the "money_stream" and "data_stream" events when new streams are received.
   */
  async connect (): Promise<void> {
    if (!this.closed) {
      return Promise.resolve()
    }
    /* tslint:disable-next-line:no-floating-promises */
    this.startSendLoop()
    await new Promise((resolve, reject) => {
      this.once('connect', resolve)
      this.once('error', (error: Error) => {
        reject(new Error(`Error connecting: ${error.message}`))
      })
      this.once('close', () => reject(new Error('Connection was closed before it was connected')))
      this.once('end', () => reject(new Error('Connection was closed before it was connected')))
    })
    this.closed = false
  }

  async end (): Promise<void> {
    this.debug('closing connection')
    this.closed = true

    for (let stream of this.streams) {
      if (stream && stream.isOpen()) {
        stream.end()
        // TODO should this mark the remoteStreams as closed?
      }
    }

    await new Promise((resolve, reject) => {
      this.once('_send_loop_finished', resolve)
      this.once('error', reject)

      this.startSendLoop()
    })
    this.safeEmit('end')
  }

  /**
   * Returns a new bidirectional money and data stream
   */
  createStream (): DataAndMoneyStream {
    // Make sure we don't open more streams than the remote will allow
    if (this.remoteConnection.maxStreamId < this.nextStreamId) {
      this.debug(`cannot creat another stream. nextStreamId: ${this.nextStreamId}, remote maxStreamId: ${this.remoteConnection.maxStreamId}`)
      this.queuedFrames.push(new ConnectionStreamIdBlockedFrame(this.nextStreamId))
      throw new Error(`Creating another stream would exceed the remote connection's maximum number of open streams`)
    }

    // TODO should this inform the other side?
    const stream = new DataAndMoneyStream({
      id: this.nextStreamId,
      isServer: this.isServer
    })
    this.streams[this.nextStreamId] = stream
    this.remoteConnection.createStream(this.nextStreamId)
    this.debug(`created stream: ${this.nextStreamId}`)
    this.nextStreamId += 2

    stream.on('_send', this.startSendLoop.bind(this))
    // TODO notify when the stream is closed

    return stream
  }

  /**
   * (Internal) Handle incoming ILP Prepare packets.
   * This will automatically fulfill all valid and expected Prepare packets.
   * It passes the incoming money and/or data to the relevant streams.
   * @private
   */
  async handlePrepare (prepare: IlpPacket.IlpPrepare): Promise<IlpPacket.IlpFulfill> {
    // Parse packet
    let requestPacket: Packet
    try {
      requestPacket = Packet.decryptAndDeserialize(this.sharedSecret, prepare.data)
    } catch (err) {
      this.debug(`error parsing frames:`, err)
      throw new IlpPacket.Errors.UnexpectedPaymentError('')
    }
    this.debug('handling packet:', JSON.stringify(requestPacket))

    if (requestPacket.ilpPacketType.valueOf() !== IlpPacket.Type.TYPE_ILP_PREPARE) {
      this.debug(`prepare packet contains a frame that says it should be something other than a prepare: ${requestPacket.ilpPacketType}`)
      throw new IlpPacket.Errors.UnexpectedPaymentError('')
    }

    let responseFrames: Frame[] = []

    const throwFinalApplicationError = () => {
      responseFrames = responseFrames.concat(this.queuedFrames)
      this.queuedFrames = []
      const responsePacket = new Packet(requestPacket.sequence, IlpPacketType.Reject, prepare.amount, responseFrames)
      this.debug(`rejecting packet ${requestPacket.sequence}: ${JSON.stringify(responsePacket)}`)
      throw new IlpPacket.Errors.FinalApplicationError('', responsePacket.serializeAndEncrypt(this.sharedSecret, (this.enablePadding ? MAX_DATA_SIZE : undefined)))
    }

    try {
      this.handleFrames(requestPacket.frames)
    } catch (err) {
      this.debug('error handling frames:', err)
      throwFinalApplicationError()
    }

    if (requestPacket.prepareAmount.isGreaterThan(prepare.amount)) {
      this.debug(`received less than minimum destination amount. actual: ${prepare.amount}, expected: ${requestPacket.prepareAmount}`)
      throwFinalApplicationError()
    }

    // Ensure we can generate correct fulfillment
    const fulfillment = cryptoHelper.generateFulfillment(this.sharedSecret, prepare.data)
    const generatedCondition = cryptoHelper.hash(fulfillment)
    if (!generatedCondition.equals(prepare.executionCondition)) {
      this.debug(`got unfulfillable prepare for amount: ${prepare.amount}. generated condition: ${generatedCondition.toString('hex')}, prepare condition: ${prepare.executionCondition.toString('hex')}`)
      throwFinalApplicationError()
    }

    // Determine amount to receive on each frame
    const amountsToReceive = []
    const totalMoneyShares = requestPacket.frames.reduce((sum: BigNumber, frame: Frame) => {
      if (frame instanceof StreamMoneyFrame) {
        return sum.plus(frame.shares)
      }
      return sum
    }, new BigNumber(0))
    for (let frame of requestPacket.frames) {
      if (!(frame instanceof StreamMoneyFrame)) {
        continue
      }
      const streamId = frame.streamId.toNumber()
      const streamAmount = new BigNumber(prepare.amount)
        .times(frame.shares)
        .dividedBy(totalMoneyShares)
        // TODO make sure we don't lose any because of rounding issues
        .integerValue(BigNumber.ROUND_FLOOR)
      amountsToReceive[streamId] = streamAmount

      // Ensure that this amount isn't more than the stream can receive
      const maxStreamCanReceive = this.streams[streamId]._getAmountStreamCanReceive()
        .times(this.allowableReceiveExtra)
        .integerValue(BigNumber.ROUND_CEIL)
      if (maxStreamCanReceive.isLessThan(streamAmount)) {
        // TODO should this be distributed to other streams if it can be?
        this.debug(`peer sent too much for stream: ${streamId}. got: ${streamAmount}, max receivable: ${maxStreamCanReceive}`)
        // Tell peer how much the streams they sent for can receive
        responseFrames.push(new StreamMoneyMaxFrame(streamId, this.streams[streamId].receiveMax, this.streams[streamId].totalReceived))

        // TODO include error frame
        throwFinalApplicationError()
      }

      // Reject the packet if any of the streams is already closed
      if (!this.streams[streamId].isOpen()) {
        this.debug(`peer sent money for stream that was already closed: ${streamId}`)
        responseFrames.push(new StreamMoneyErrorFrame(streamId, 'StreamStateError', 'Stream is already closed'))

        throwFinalApplicationError()
      }
    }

    // Add incoming amounts to each stream
    for (let streamId in amountsToReceive) {
      if (amountsToReceive[streamId]) {
        this.streams[streamId]._addToIncoming(amountsToReceive[streamId])
      }
    }

    // Tell peer about closed streams and how much each stream can receive
    for (let stream of this.streams) {
      if (stream) {
        const remoteStream = this.remoteConnection.streams[stream.id]
        if (!this.remoteConnection.closed
          && !stream.isOpen()
          && !remoteStream.closed
          && stream._getAmountAvailableToSend().isEqualTo(0)) {
          this.debug(`telling other side that stream ${stream.id} is closed`)
          // TODO don't use an error frame
          responseFrames.push(new StreamMoneyErrorFrame(stream.id, 'NoError', ''))
          // TODO confirm that they get this
          remoteStream.closed = true
        } else if (!remoteStream.remoteReceiveMax.isEqualTo(stream.receiveMax)) {
          this.debug(`telling other side that stream ${stream.id} can receive ${stream.receiveMax}`)
          responseFrames.push(new StreamMoneyMaxFrame(stream.id, stream.receiveMax, stream.totalReceived))
          remoteStream.remoteReceiveMax = new BigNumber(stream.receiveMax)
        }
      }
    }

    // TODO make sure the queued frames aren't too big
    responseFrames = responseFrames.concat(this.queuedFrames)
    this.queuedFrames = []

    // Return fulfillment and response packet
    const responsePacket = new Packet(requestPacket.sequence, IlpPacketType.Fulfill, prepare.amount, responseFrames)
    this.debug(`fulfilling prepare with fulfillment: ${fulfillment.toString('hex')} and response packet: ${JSON.stringify(responsePacket)}`)
    return {
      fulfillment,
      data: responsePacket.serializeAndEncrypt(this.sharedSecret, (this.enablePadding ? MAX_DATA_SIZE : undefined))
    }
  }

  protected handleFrames (frames: Frame[]): void {
    for (let frame of frames) {
      switch (frame.type) {
        case FrameType.ConnectionNewAddress:
          this.debug(`peer notified us of their account: ${frame.sourceAccount}`)
          const firstConnection = this.remoteConnection.sourceAccount === undefined
          this.remoteConnection.sourceAccount = frame.sourceAccount
          if (firstConnection) {
            this.handleConnect()
          }
          // TODO reset the exchange rate and send a test packet to make sure they haven't spoofed the address
          break
        case FrameType.ConnectionError:
          if (frame.errorCode === 'NoError') {
            this.debug(`remote closed connection`)
          } else {
            this.debug(`remote connection error. code: ${frame.errorCode}, message: ${frame.errorMessage}`)
            this.emit('error', new Error(`Remote connection error. Code: ${frame.errorCode}, message: ${frame.errorMessage}`))
          }

          // TODO end the connection in some other way
          this.closed = true
          this.remoteConnection.closed = true
          this.end()
          break
        case FrameType.ApplicationError:
          this.debug(`remote connection error code: ${frame.errorCode}, message: ${frame.errorMessage}`)
          this.emit('error', new Error(`Remote connection error code: ${frame.errorCode}, message: ${frame.errorMessage}`))
          // TODO end the connection in some other way
          this.closed = true
          this.remoteConnection.closed = true
          this.end()
          break
        case FrameType.ConnectionMaxStreamId:
          // TODO make sure the number isn't lowered
          this.debug(`remote set max stream id to ${frame.maxStreamId}`)
          this.remoteConnection.maxStreamId = frame.maxStreamId.toNumber()
          break
        case FrameType.ConnectionStreamIdBlocked:
          this.debug(`remote wants to open more streams but we are blocking them`)
          break
        case FrameType.StreamMoney:
          this.handleNewStream(frame)
          break
        case FrameType.StreamMoneyEnd:
          this.handleNewStream(frame)
          this.handleStreamEnd(frame)
          break
        case FrameType.StreamMoneyMax:
          this.handleNewStream(frame)
          this.debug(`peer told us that stream ${frame.streamId} can receive up to: ${frame.receiveMax} and has received: ${frame.totalReceived} so far`)
          const remoteStream = this.remoteConnection.streams[frame.streamId.toNumber()]
          remoteStream.totalReceived = BigNumber.maximum(remoteStream.totalReceived, frame.totalReceived)
          if (remoteStream.receiveMax.isFinite()) {
            remoteStream.receiveMax = BigNumber.maximum(remoteStream.receiveMax, frame.receiveMax)
          } else {
            remoteStream.receiveMax = frame.receiveMax
          }
          if (remoteStream.receiveMax.isGreaterThan(remoteStream.totalReceived)) {
            this.startSendLoop()
          }
          break
        case FrameType.StreamMoneyError:
          this.handleNewStream(frame)
          this.handleStreamError(frame)
          break
        case FrameType.StreamData:
          this.handleNewStream(frame)
          this.handleData(frame)
          break
        case FrameType.StreamDataEnd:
          this.handleNewStream(frame)
          this.handleData(frame)
          this.handleStreamEnd(frame)
          break
        default:
          continue
      }
    }
  }

  protected handleConnect () {
    this.closed = false
    this.debug('connected')
    this.safeEmit('connect')

    // Tell the other side our max stream id
    this.queuedFrames.push(new ConnectionMaxStreamIdFrame(this.maxStreamId))
  }

  protected handleNewStream (frame: StreamMoneyFrame | StreamMoneyMaxFrame | StreamMoneyErrorFrame | StreamDataFrame): void {
    const streamId = frame.streamId.toNumber()
    if (this.streams[streamId]) {
      return
    }

    // Validate stream ID
    if (this.isServer && streamId % 2 === 0) {
      this.debug(`got invalid stream ID ${streamId} from peer (should be odd)`)
      this.queuedFrames.push(new ConnectionErrorFrame('ProtocolViolation', `Invalid Stream ID: ${streamId}. Client-initiated streams must have odd-numbered IDs`))
      const err = new Error(`Invalid Stream ID: ${streamId}. Client-initiated streams must have odd-numbered IDs`)
      this.safeEmit('error', err)
      throw err
    } else if (!this.isServer && streamId % 2 === 1) {
      this.debug(`got invalid stream ID ${streamId} from peer (should be even)`)
      this.queuedFrames.push(new ConnectionErrorFrame('ProtocolViolation', `Invalid Stream ID: ${streamId}. Server-initiated streams must have even-numbered IDs`))
      const err = new Error(`Invalid Stream ID: ${streamId}. Server-initiated streams must have even-numbered IDs`)
      this.safeEmit('error', err)
      throw err
    }

    // Make sure there aren't too many open streams
    if (streamId > this.maxStreamId) {
      this.debug(`peer opened too many streams. got stream: ${streamId}, but max stream id is: ${this.maxStreamId}. closing connection`)
      this.queuedFrames.push(new ConnectionErrorFrame('StreamIdError', `Maximum number of open streams exceeded. Got stream: ${streamId}, current max stream ID: ${this.maxStreamId}`))
      const err = new Error(`Maximum number of open streams exceeded. Got stream: ${streamId}, current max stream ID: ${this.maxStreamId}`)
      this.safeEmit('error', err)
      throw err
    }

    // Let the other side know if they're getting close to the number of streams
    if (this.maxStreamId * .75 < streamId) {
      this.debug(`informing peer that our max stream id is: ${this.maxStreamId}`)
      this.queuedFrames.push(new ConnectionMaxStreamIdFrame(this.maxStreamId))
    }

    this.debug(`got new stream: ${streamId}`)
    const stream = new DataAndMoneyStream({
      id: streamId,
      isServer: this.isServer
    })
    this.streams[streamId] = stream
    this.remoteConnection.streams[streamId] = new RemoteStream()
    stream.on('_send', () => this.startSendLoop())
    this.safeEmit('stream', stream)
  }

  protected handleStreamEnd (frame: StreamMoneyFrame | StreamDataFrame) {
    const streamId = frame.streamId.toNumber()
    const stream = this.streams[streamId]
    if (!stream) {
      this.debug(`told to close stream ${streamId}, but we don't have a record of that stream`)
      return
    }

    // TODO delete stream record and make sure the other side can't reopen it

    this.debug(`peer closed stream ${stream.id}`)
    // TODO should we confirm with the other side that we closed it?
    stream._sentEnd = true
    stream.end()

    this.raiseMaxStreamId()
  }

  protected handleStreamError (frame: StreamMoneyErrorFrame) {
    const streamId = frame.streamId.toNumber()
    const stream = this.streams[streamId]
    if (!stream) {
      this.debug(`remote error on stream ${streamId}, but we don't have a record of that stream`)
      return
    }

    // TODO delete stream record and make sure the other side can't reopen it

    this.debug(`peer closed stream ${stream.id} with error code: ${frame.errorCode} and message: ${frame.errorMessage}`)
    // TODO should we confirm with the other side that we closed it?
    stream._sentEnd = true
    // TODO should we emit an error on the stream?
    stream.end()

    this.raiseMaxStreamId()
  }

  protected raiseMaxStreamId () {
    // TODO make sure we don't send more than one of these frames per packet
    this.maxStreamId += 2
    this.debug(`raising maxStreamId to ${this.maxStreamId}`)
    this.queuedFrames.push(new ConnectionMaxStreamIdFrame(this.maxStreamId))
  }

  protected handleData (frame: StreamDataFrame) {
    this.debug(`got data for stream ${frame.streamId}`)

    // TODO handle if it's too much
    this.streams[frame.streamId.toNumber()]._pushIncomingData(frame.data, frame.offset.toNumber())
  }

  /**
   * (Internal) Start sending packets with money and/or data, as necessary.
   * @private
   */
  protected async startSendLoop () {
    if (this.sending) {
      return
    }
    if (this.remoteConnection.closed) {
      this.debug('remote connection is already closed, not starting another loop')
      this.safeEmit('_send_loop_finished')
      return
    }
    this.sending = true
    this.debug('starting send loop')

    if (!this.remoteConnection.sourceAccount) {
      this.debug('not sending because we do not know the client\'s address')
      this.sending = false
      return
    }

    try {
      while (this.sending) {
        // Send a test packet first to determine the exchange rate
        if (!this.exchangeRate) {
          this.debug('determining exchange rate')
          await this.sendTestPacket()

          if (this.exchangeRate) {
            this.safeEmit('connect')
            this.debug('connected')
          }
        } else {
          // TODO Send multiple packets at the same time (don't await promise)
          // TODO Figure out if we need to wait before sending the next one
          await this.loadAndSendPacket()
        }
      }
    } catch (err) {
      // TODO should a connection error be an error on all of the streams?
      for (let stream of this.streams) {
        if (stream) {
          stream.emit('error', err)
        }
      }
      return this.connectionError(err)
    }
    this.debug('finished sending')
    this.safeEmit('_send_loop_finished')
  }

  /**
   * Load up a packet money and/or data, send it to the other party, and handle the result.
   * @private
   */
  protected async loadAndSendPacket (): Promise<void> {
    // Actually send on the next tick of the event loop in case multiple streams
    // have their limits raised at the same time
    await new Promise((resolve, reject) => setImmediate(resolve))

    this.debug('loadAndSendPacket')
    let amountToSend = new BigNumber(0)

    // Set packet number to correlate response with request
    const requestPacket = new Packet(this.nextPacketSequence++, IlpPacketType.Prepare)

    // TODO make sure these aren't too big
    requestPacket.frames = this.queuedFrames
    this.queuedFrames = []

    // Send control frames
    // TODO only send the max amount when it changes
    for (let stream of this.streams) {
      if (stream && stream.isOpen()) {
        requestPacket.frames.push(new StreamMoneyMaxFrame(stream.id, stream.receiveMax, stream.totalReceived))
      }
    }
    if (this.closed && !this.remoteConnection.closed) {
      // TODO how do we know if there was an error?
      this.debug('sending connection close frame')
      requestPacket.frames.push(new ConnectionErrorFrame('NoError', ''))
      // TODO don't put any more frames because the connection is closed
      // TODO only mark this as closed once we confirm that with the receiver
      this.remoteConnection.closed = true
    }

    // Determine how much to send based on amount frames and path maximum packet amount
    let maxAmountFromNextStream = this.testMaximumPacketAmount
    const streamsSentFrom = []
    for (let stream of this.streams) {
      if (!stream || stream._sentEnd) {
        // TODO just remove closed streams?
        continue
      }
      const remoteStream = this.remoteConnection.streams[stream.id]

      // Determine how much to send from this stream based on how much it has available
      // and how much the receiver side of this stream can receive
      let amountToSendFromStream = BigNumber.minimum(stream._getAmountAvailableToSend(), maxAmountFromNextStream)
      if (this.exchangeRate) {
        const maxDestinationAmount = remoteStream.receiveMax.minus(remoteStream.totalReceived)
        const maxSourceAmount = maxDestinationAmount.dividedBy(this.exchangeRate).integerValue(BigNumber.ROUND_CEIL)
        if (maxSourceAmount.isLessThan(amountToSendFromStream)) {
          this.debug(`stream ${stream.id} could send ${amountToSendFromStream} but that would be more than the receiver says they can receive, so we'll send ${maxSourceAmount} instead`)
          amountToSendFromStream = maxSourceAmount
        }
      }
      this.debug(`amount to send from stream ${stream.id}: ${amountToSendFromStream}, exchange rate: ${this.exchangeRate}, remote total received: ${remoteStream.totalReceived}, remote receive max: ${remoteStream.receiveMax}`)

      // Hold the money and add a frame to the packet
      if (amountToSendFromStream.isGreaterThan(0)) {
        stream._holdOutgoing(requestPacket.sequence.toString(), amountToSendFromStream)
        // TODO make sure the length of the frames doesn't exceed packet data limit
        requestPacket.frames.push(new StreamMoneyFrame(stream.id, amountToSendFromStream))
        amountToSend = amountToSend.plus(amountToSendFromStream)
        maxAmountFromNextStream = maxAmountFromNextStream.minus(amountToSendFromStream)
        streamsSentFrom.push(stream)
      }

      if (maxAmountFromNextStream.isEqualTo(0)) {
        // TODO make sure that we start with those later frames the next time around
        break
      }
    }

    // Send data
    let sendingData = false
    let bytesLeftInPacket = MAX_DATA_SIZE - requestPacket.byteLength()
    for (let stream of this.streams) {
      // TODO send only up to the max packet data
      if (!stream) {
        continue
      }
      // TODO use a sensible estimate for the StreamDataFrame overhead
      const { data, offset } = stream._getAvailableDataToSend(bytesLeftInPacket - 20)
      if (data && data.length > 0) {
        const streamDataFrame = new StreamDataFrame(stream.id, offset, data || Buffer.alloc(0))
        bytesLeftInPacket -= streamDataFrame.byteLength()
        requestPacket.frames.push(streamDataFrame)
        // TODO actually figure out if there's more data to send
        sendingData = true
      }
    }

    // Stop sending if there's no more to send
    // TODO don't stop if there's still data to send
    if (amountToSend.isEqualTo(0) && !sendingData) {
      this.debug(`packet value is 0 so we'll send this packet and then stop`)
      this.sending = false
      // TODO figure out if there are control frames we need to send and stop sending if not
    }

    // Tell other side which streams are closed
    // TODO how do we tell them the stream is half closed but there's still data or money to send
    for (let stream of this.streams) {
      if (!stream || this.closed || stream.isOpen() || stream._sentEnd) {
        continue
      }
      if (stream._getAmountAvailableToSend().isGreaterThan(0)) {
        this.debug(`stream ${stream.id} is closed but still has money to send, not sending end frame yet`)
        continue
      }
      if (stream._hasDataToSend()) {
        this.debug(`stream ${stream.id} is closed but still has data to send, not sending end frame yet`)
        continue
      }
      const streamEndFrame = new StreamMoneyErrorFrame(stream.id, 'NoError', '')

      // Make sure the packet has space left
      if (streamEndFrame.byteLength() > bytesLeftInPacket) {
        // TODO make sure it will actually make another pass to send these later
        this.debug('not sending more stream end frames because the packet is full')
        break
      }
      this.debug(`sending end frame for stream ${stream.id}`)
      // TODO should this be a Stream{Money,Data} frame with isEnd set instead?
      requestPacket.frames.push(streamEndFrame)
      bytesLeftInPacket -= streamEndFrame.byteLength()
      // TODO only set this to true if the packet gets through to the receiver
      stream._sentEnd = true
    }

    // Set minimum destination amount
    if (this.exchangeRate) {
      const minimumDestinationAmount = amountToSend.times(this.exchangeRate)
        .times(new BigNumber(1).minus(this.slippage))
        .integerValue(BigNumber.ROUND_FLOOR)
      if (minimumDestinationAmount.isGreaterThan(0)) {
        requestPacket.prepareAmount = minimumDestinationAmount
      }
    }

    if (amountToSend.isEqualTo(0) && requestPacket.frames.length === 0) {
      this.debug(`no money or data needs to be send, stopping loop`)
      this.sending = false
      return
    }

    const responsePacket = await this.sendPacket(requestPacket, amountToSend, false)

    if (responsePacket) {
      this.handleFrames(responsePacket.frames)
    }

    if (!responsePacket || responsePacket.ilpPacketType === IlpPacketType.Reject) {
      // Handle reject
      this.debug(`packet ${requestPacket.sequence} was rejected`)

      // Put money back into MoneyStreams
      for (let stream of streamsSentFrom) {
        stream._cancelHold(requestPacket.sequence.toString())
      }
    } else {
      for (let stream of streamsSentFrom) {
        stream._executeHold(requestPacket.sequence.toString())
      }

      // If we're trying to pinpoint the Maximum Packet Amount, raise
      // the limit because we know that the testMaximumPacketAmount works
      if (this.maximumPacketAmount.isFinite()
        && amountToSend.isEqualTo(this.testMaximumPacketAmount)
        && this.testMaximumPacketAmount.isLessThan(this.maximumPacketAmount)) {
        const newTestMax = this.maximumPacketAmount.plus(this.testMaximumPacketAmount).dividedToIntegerBy(2)
        this.debug(`maximum packet amount is between ${this.testMaximumPacketAmount} and ${this.maximumPacketAmount}, trying: ${newTestMax}`)
        this.testMaximumPacketAmount = newTestMax
      }

      // Reset the retry delay
      this.retryDelay = RETRY_DELAY_START
    }
  }

  /**
   * (Internal) Send an unfulfillable test packet. Primarily used for determining the path exchange rate.
   * @private
   */
  protected async sendTestPacket (amount?: BigNumber): Promise<void> {
    this.debug('sendTestPacket')
    if (!this.remoteConnection.sourceAccount) {
      throw new Error('Cannot send test packet. Destination account is unknown')
    }

    // Set packet number to correlate response with request
    const requestPacket = new Packet(this.nextPacketSequence++, IlpPacketType.Prepare)

    if (!this.remoteConnection.knowsOurAccount) {
      this.debug('sending source address to peer')
      // TODO attach a token to the account?
      requestPacket.frames.push(new ConnectionNewAddressFrame(this.sourceAccount))
    }

    const sourceAmount = amount || BigNumber.minimum(TEST_PACKET_AMOUNT, this.testMaximumPacketAmount)

    const responsePacket = await this.sendPacket(requestPacket, sourceAmount, true)
    if (!responsePacket) {
      return
    }

    this.remoteConnection.knowsOurAccount = true

    // Determine exchange rate from amount that arrived
    this.exchangeRate = responsePacket.prepareAmount.dividedBy(sourceAmount)
    this.debug(`determined exchange rate to be: ${this.exchangeRate}`)
    if (this.exchangeRate.isEqualTo(0)) {
      // TODO this could also happen if the exchange rate is less than 1 / TEST_PACKET_AMOUNT
      throw new Error('Exchange rate is 0. We will not be able to send anything through this path')
    }

    this.handleFrames(responsePacket.frames)
  }

  protected async connectionError (error: ConnectionError | Error | string): Promise<void> {
    const err = (error instanceof ConnectionError || error instanceof Error ? error : new Error(error))
    this.debug(`closing connection with error:`, err)
    this.safeEmit('error', err)

    this.closed = true
    this.sending = false
    const errorCode = (error instanceof ConnectionError ? error.streamErrorCode : ErrorCode.InternalError)
    const packet = new Packet(this.nextPacketSequence, IlpPacketType.Prepare, 0, [
      new ConnectionErrorFrame(errorCode, err.message)
    ])
    try {
      await this.sendPacket(packet, new BigNumber(0), true)
    } catch (err) {
      this.debug(`error while trying to inform peer that connection is closing, but closing anyway`, err)
    }
    this.remoteConnection.closed = true
  }

  protected async sendPacket (packet: Packet, sourceAmount: BigNumber, unfulfillable = false): Promise<Packet | void> {
    this.debug(`sending packet ${packet.sequence} with source amount: ${sourceAmount}: ${JSON.stringify(packet)})`)
    const data = packet.serializeAndEncrypt(this.sharedSecret, (this.enablePadding ? MAX_DATA_SIZE : undefined))

    let fulfillment: Buffer | undefined
    let executionCondition: Buffer
    if (unfulfillable) {
      fulfillment = undefined
      executionCondition = cryptoHelper.generateRandomCondition()
    } else {
      fulfillment = cryptoHelper.generateFulfillment(this.sharedSecret, data)
      executionCondition = cryptoHelper.hash(fulfillment)
    }
    const prepare = {
      destination: this.remoteConnection.sourceAccount!,
      amount: (sourceAmount).toString(),
      data,
      executionCondition,
      expiresAt: new Date(Date.now() + 30000)
    }

    const responseData = await this.plugin.sendData(IlpPacket.serializeIlpPrepare(prepare))

    let response: IlpPacket.IlpFulfill | IlpPacket.IlpRejection
    try {
      if (responseData[0] === IlpPacket.Type.TYPE_ILP_FULFILL) {
        response = IlpPacket.deserializeIlpFulfill(responseData)
      } else if (responseData[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
        response = IlpPacket.deserializeIlpReject(responseData)
      } else {
        throw new Error(`Invalid response packet type: ${responseData[0]}`)
      }
    } catch (err) {
      this.debug(`got invalid response from sending packet ${packet.sequence}:`, err, responseData.toString('hex'))
      throw new Error(`Invalid response when sending packet ${packet.sequence}: ${err.message}`)
    }

    // Handle fulfillment
    if (fulfillment && isFulfill(response)) {
      if (!cryptoHelper.hash(response.fulfillment).equals(executionCondition)) {
        this.debug(`got invalid fulfillment for packet ${packet.sequence}: ${response.fulfillment.toString('hex')}. expected: ${fulfillment.toString('hex')} for condition: ${executionCondition.toString('hex')}`)
        throw new Error(`Got invalid fulfillment for packet ${packet.sequence}. Actual: ${response.fulfillment.toString('hex')}, expected: ${fulfillment.toString('hex')}`)
      }
    } else if ((response as IlpPacket.IlpRejection).code !== 'F99') {
      return this.handleConnectorError((response as IlpPacket.IlpRejection), sourceAmount)
    }

    // Parse response data from receiver
    let responsePacket: Packet
    try {
      responsePacket = Packet.decryptAndDeserialize(this.sharedSecret, response.data)
    } catch (err) {
      this.debug(`unable to decrypt and parse response data:`, err, response.data.toString('hex'))
      // TODO should we continue processing anyway? what if it was fulfilled?
      throw new Error('Unable to decrypt and parse response data: ' + err.message)
    }

    // Ensure the response corresponds to the request
    if (!responsePacket.sequence.isEqualTo(packet.sequence)) {
      this.debug(`response packet sequence does not match the request packet. expected sequence: ${packet.sequence}, got response packet:`, JSON.stringify(responsePacket))
      throw new Error(`Response packet sequence does not correspond to the request. Actual: ${responsePacket.sequence}, expected: ${packet.sequence}`)
    }
    if (responsePacket.ilpPacketType !== responseData[0]) {
      this.debug(`response packet was on wrong ILP packet type. expected ILP packet type: ${responseData[0]}, got:`, JSON.stringify(responsePacket))
      throw new Error(`Response says it should be on an ILP packet of type: ${responsePacket.ilpPacketType} but it was carried on an ILP packet of type: ${responseData[0]}`)
    }

    this.debug(`got response to packet: ${packet.sequence}: ${JSON.stringify(responsePacket)}`)

    return responsePacket
  }

  /**
   * (Internal) Handle final and temporary errors that were not generated by the receiver.
   * @private
   */
  protected async handleConnectorError (reject: IlpPacket.IlpRejection, amountSent: BigNumber) {
    this.debug(`handling reject:`, JSON.stringify(reject))
    if (reject.code === 'F08') {
      let receivedAmount
      let maximumAmount
      try {
        const reader = Reader.from(reject.data)
        receivedAmount = reader.readUInt64BigNum()
        maximumAmount = reader.readUInt64BigNum()
      } catch (err) {
        receivedAmount = undefined
        maximumAmount = undefined
      }
      if (receivedAmount && maximumAmount && receivedAmount.isGreaterThan(maximumAmount)) {
        const newMaximum = amountSent
          .times(maximumAmount)
          .dividedToIntegerBy(receivedAmount)
        this.debug(`reducing maximum packet amount from ${this.maximumPacketAmount} to ${newMaximum}`)
        this.maximumPacketAmount = newMaximum
        this.testMaximumPacketAmount = newMaximum
      } else {
        // Connector didn't include amounts
        this.maximumPacketAmount = amountSent.minus(1)
        this.testMaximumPacketAmount = this.maximumPacketAmount.dividedToIntegerBy(2)
      }
      if (this.maximumPacketAmount.isEqualTo(0)) {
        this.debug(`cannot send anything through this path. the maximum packet amount is 0`)
        throw new Error('Cannot send. Path has a Maximum Packet Amount of 0')
      }
    } else if (reject.code[0] === 'T') {
      this.debug(`got temporary error. waiting ${this.retryDelay} before trying again`)
      const delay = this.retryDelay
      this.retryDelay = this.retryDelay * 2
      await new Promise((resolve, reject) => setTimeout(resolve, delay))
    } else {
      this.debug(`unexpected error. code: ${reject.code}, message: ${reject.message}, data: ${reject.data.toString('hex')}`)
      throw new Error(`Unexpected error while sending packet. Code: ${reject.code}, message: ${reject.message}`)
    }
  }

  protected safeEmit (event: string, ...args: any[]) {
    try {
      args.unshift(event)
      this.emit.apply(this, args)
    } catch (err) {
      this.debug(`error in ${event} handler:`, err)
    }
  }
}

function isFulfill (packet: IlpPacket.IlpFulfill | IlpPacket.IlpRejection): packet is IlpPacket.IlpFulfill {
  return packet.hasOwnProperty('fulfillment')
}

export class ConnectionError extends Error {
  streamErrorCode: ErrorCode

  constructor (message: string, streamErrorCode?: ErrorCode) {
    super(message)
    this.streamErrorCode = streamErrorCode || ErrorCode.InternalError
  }
}
