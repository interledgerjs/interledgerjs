import EventEmitter3 = require('eventemitter3')
import * as Debug from 'debug'
import { MoneyStream } from './money-stream'
import * as IlpPacket from 'ilp-packet'
import * as cryptoHelper from './crypto'
import {
  Frame,
  StreamMoneyFrame,
  parseFrames,
  isStreamMoneyFrame,
  SourceAccountFrame,
  isSourceAccountFrame,
  AmountArrivedFrame,
  isAmountArrivedFrame,
  isMinimumDestinationAmountFrame,
  MinimumDestinationAmountFrame
} from './frame'
import { Reader, Writer } from 'oer-utils'
import { Plugin } from './types'
import BigNumber from 'bignumber.js'

const TEST_PACKET_AMOUNT = new BigNumber(1000)

export interface ConnectionOpts {
  plugin: Plugin,
  destinationAccount?: string,
  sourceAccount: string,
  sharedSecret: Buffer,
  isServer: boolean,
  slippage?: BigNumber.Value
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
  protected slippage: BigNumber

  protected moneyStreams: StreamData<MoneyStream>[]
  protected nextStreamId: number
  protected debug: Debug.IDebugger
  protected sending: boolean
  protected maximumPacketAmount: BigNumber
  protected closed: boolean
  protected shouldSendSourceAccount: boolean
  protected exchangeRate?: BigNumber

  constructor (opts: ConnectionOpts) {
    super()
    this.plugin = opts.plugin
    this.destinationAccount = opts.destinationAccount
    this.sourceAccount = opts.sourceAccount
    this.sharedSecret = opts.sharedSecret
    this.isServer = opts.isServer
    this.slippage = new BigNumber(opts.slippage || 0)

    this.moneyStreams = []
    this.nextStreamId = (this.isServer ? 1 : 2)
    this.debug = Debug(`ilp-protocol-stream:Connection:${this.isServer ? 'Server' : 'Client'}`)
    this.sending = false
    this.closed = true
    this.shouldSendSourceAccount = !opts.isServer

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

    // Parse frames
    let frames
    try {
      frames = parseFrames(frameData)
    } catch (err) {
      this.debug(`error parsing frames:`, err)
      throw new IlpPacket.Errors.UnexpectedPaymentError('')
    }

    const responseFrames: Frame[] = []

    // Tell sender how much arrived
    responseFrames.push(new AmountArrivedFrame(prepare.amount))

    // Handle non-money frames
    // (We'll use these even if the packet is unfulfillable)
    let totalMoneyShares = new BigNumber(0)
    for (let frame of frames) {
      if (isSourceAccountFrame(frame)) {
        this.debug(`peer notified us of their account: ${frame.sourceAccount}`)
        this.destinationAccount = frame.sourceAccount
        // Try sending in case we stopped because we didn't know their address before
        this.emit('_send')
      } else if (isMinimumDestinationAmountFrame(frame)) {
        if (frame.amount.isLessThan(prepare.amount)) {
          this.debug(`received less than minimum destination amount. actual: ${prepare.amount}, expected: ${frame.amount}`)
          throw new IlpPacket.Errors.FinalApplicationError('', this.encodeAndEncryptData(responseFrames))
        }
      } else if (isStreamMoneyFrame(frame)) {
        // Count the total number of "shares" to be able to distribute the packet amount amongst the MoneyStreams
        totalMoneyShares = totalMoneyShares.plus(frame.shares)
      }
    }

    // Ensure we can generate correct fulfillment
    const fulfillment = cryptoHelper.generateFulfillment(this.sharedSecret, prepare.data)
    const generatedCondition = cryptoHelper.hash(fulfillment)
    if (!generatedCondition.equals(prepare.executionCondition)) {
      this.debug(`got unfulfillable prepare for amount: ${prepare.amount}. generated condition: ${generatedCondition.toString('hex')}, prepare condition: ${prepare.executionCondition.toString('hex')}`)
      throw new IlpPacket.Errors.FinalApplicationError('', this.encodeAndEncryptData(responseFrames))
    }

    // Make sure prepare amount >= sum of stream frame amounts

    // TODO ensure that no money frame exceeds a stream's buffer

    // Handle money stream frames
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
        const amount = new BigNumber(prepare.amount)
          .times(frame.shares)
          .dividedBy(totalMoneyShares)
          // TODO make sure we don't lose any because of rounding issues
          .integerValue(BigNumber.ROUND_FLOOR)
        this.moneyStreams[streamId].stream._addToIncoming(amount)
      }
    }

    this.debug(`fulfilling prepare with fulfillment: ${fulfillment.toString('hex')}`)

    // Return fulfillment
    return {
      fulfillment,
      data: this.encodeAndEncryptData(responseFrames)
    }
  }

  protected async startSendLoop () {
    if (this.sending) {
      this.debug('already sending, not starting another loop')
      return
    }
    this.sending = true

    // Send a test packet first to determine the exchange rate
    if (!this.exchangeRate && this.destinationAccount) {
      await this.sendTestPacket()
    }

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

    // Send control frames

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

    // Stop sending if there's no more to send
    // TODO don't stop if there's still data to send
    if (amountToSend.isEqualTo(0)) {
      this.sending = false
    }

    // Set minimum destination amount
    if (this.exchangeRate) {
      const minimumDestinationAmount = amountToSend.times(this.exchangeRate)
        .times(new BigNumber(1).minus(this.slippage))
        .integerValue(BigNumber.ROUND_FLOOR)
      frames.push(new MinimumDestinationAmountFrame(minimumDestinationAmount))
    }

    // Load packet data with available data frames (keep track of max data length)
    // TODO implement sending data

    // Encrypt
    const data = this.encodeAndEncryptData(frames)

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

  protected async sendTestPacket (amount?: BigNumber) {
    if (!this.destinationAccount) {
      throw new Error('Cannot send test packet. Destination account is unknown')
    }

    const frames = []
    if (this.shouldSendSourceAccount) {
      // TODO attach a token to the account?
      frames.push(new SourceAccountFrame(this.sourceAccount))

      // TODO make sure to reset this if the packet fails
      this.shouldSendSourceAccount = false
    }

    const sourceAmount = amount || BigNumber.minimum(TEST_PACKET_AMOUNT, this.maximumPacketAmount)
    this.debug(`sending test packet for amount: ${sourceAmount}`)
    const prepare = {
      destination: this.destinationAccount,
      amount: (sourceAmount).toString(),
      data: this.encodeAndEncryptData(frames),
      executionCondition: cryptoHelper.generateRandomCondition(),
      expiresAt: new Date(Date.now() + 30000)
    }

    const result = await this.plugin.sendData(IlpPacket.serializeIlpPrepare(prepare))

    let reject: IlpPacket.IlpRejection
    try {
      reject = IlpPacket.deserializeIlpReject(result)
    } catch (err) {
      this.debug(`response is not an ILP Reject packet:`, result.toString('hex'))
      throw new Error('Response to sendTestPacket is not an ILP Reject packet')
    }

    // TODO handle F08 errors
    if (reject.code === 'F99' && reject.data.length > 0) {
      let frames: Frame[]
      try {
        const decrypted = cryptoHelper.decrypt(this.sharedSecret, reject.data)
        frames = parseFrames(decrypted)
      } catch (err) {
        this.debug(`unable to decrypt test packet response:`, err, reject.data.toString('hex'))
        throw new Error('Test packet response was corrupted')
      }

      for (let frame of frames) {
        if (isAmountArrivedFrame(frame)) {
          this.exchangeRate = frame.amount.dividedBy(sourceAmount)
          this.debug(`determined exchange rate to be: ${this.exchangeRate}`)
          break
        }
      }
      if (!this.exchangeRate) {
        throw new Error('No AmountArrivedFrame in test packet response')
      } else if (this.exchangeRate.isEqualTo(0)) {
        // TODO this could also happen if the exchange rate is less than 1 / TEST_PACKET_AMOUNT
        throw new Error('Exchange rate is 0. We will not be able to send anything through this path')
      }
    } else {
      this.debug(`unexpected test packet response. code: ${reject.code}, message: ${reject.message}, data: ${reject.data.toString('hex')}`)
      throw new Error(`Unexpected test packet response: ${reject.code}`)
    }
  }

  protected encodeAndEncryptData (frames: Frame[]): Buffer {
    const writer = new Writer()
    for (let frame of frames) {
      frame.writeTo(writer)
    }
    const encodedFrames = writer.getBuffer()
    const data = cryptoHelper.encrypt(this.sharedSecret, encodedFrames)
    return data
  }
}
