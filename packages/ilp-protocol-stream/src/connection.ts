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
  MinimumDestinationAmountFrame,
  PacketNumberFrame,
  isPacketNumberFrame,
  PacketType
} from './frame'
import { Writer, Reader } from 'oer-utils'
import { Plugin } from './types'
import BigNumber from 'bignumber.js'
import 'source-map-support/register'

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

  protected outgoingPacketNumber: number
  protected moneyStreams: StreamData<MoneyStream>[]
  protected nextStreamId: number
  protected debug: Debug.IDebugger
  protected sending: boolean
  /** Used to probe for the Maximum Packet Amount if the connectors don't tell us directly */
  protected testMaximumPacketAmount: BigNumber
  /** The path's Maximum Packet Amount, discovered through F08 errors */
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

    this.outgoingPacketNumber = 0
    this.moneyStreams = []
    this.nextStreamId = (this.isServer ? 1 : 2)
    this.debug = Debug(`ilp-protocol-stream:${this.isServer ? 'Server' : 'Client'}:Connection`)
    this.sending = false
    this.closed = true
    this.shouldSendSourceAccount = !opts.isServer

    this.maximumPacketAmount = new BigNumber(Infinity)
    this.testMaximumPacketAmount = new BigNumber(Infinity)

    // TODO limit total amount buffered for all streams?
  }

  // TODO should this be async and resolve when it's connected?
  connect (): void {
    this.startSendLoop()
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

    stream.on('_send', this.startSendLoop.bind(this))
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
    let requestFrames
    try {
      requestFrames = parseFrames(frameData)
    } catch (err) {
      this.debug(`error parsing frames:`, err)
      throw new IlpPacket.Errors.UnexpectedPaymentError('')
    }

    const responseFrames: Frame[] = []

    // Tell sender how much arrived
    responseFrames.push(new AmountArrivedFrame(prepare.amount))

    const packetNumberFrame = requestFrames.find(isPacketNumberFrame)
    let packetNumber: BigNumber
    if (!packetNumberFrame) {
      this.debug('prepare did not include packet number frame')
      throw new IlpPacket.Errors.UnexpectedPaymentError('')
    } else {
      packetNumber = packetNumberFrame.packetNumber
      if (packetNumberFrame.packetType !== PacketType.Prepare) {
        this.debug(`prepare packet contains a frame that says it should be something other than a prepare: ${packetNumberFrame.packetType}`)
        throw new IlpPacket.Errors.UnexpectedPaymentError('')
      }
    }
    this.debug(`handling packet number: ${packetNumber} with frames: ${JSON.stringify(requestFrames)}`)

    const throwFinalApplicationError = () => {
      responseFrames.push(new PacketNumberFrame(packetNumber, PacketType.Reject))
      const responseData = this.encodeAndEncryptData(responseFrames)
      throw new IlpPacket.Errors.FinalApplicationError('', responseData)
    }

    // Handle non-money frames
    // (We'll use these even if the packet is unfulfillable)
    let totalMoneyShares = new BigNumber(0)
    for (let frame of requestFrames) {
      if (isSourceAccountFrame(frame)) {
        this.debug(`peer notified us of their account: ${frame.sourceAccount}`)
        this.destinationAccount = frame.sourceAccount
        // Try sending in case we stopped because we didn't know their address before
        this.emit('_send')
      } else if (isMinimumDestinationAmountFrame(frame)) {
        if (frame.amount.isLessThan(prepare.amount)) {
          this.debug(`received less than minimum destination amount. actual: ${prepare.amount}, expected: ${frame.amount}`)
          throwFinalApplicationError()
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
      throwFinalApplicationError()
    }

    // Make sure prepare amount >= sum of stream frame amounts

    // TODO ensure that no money frame exceeds a stream's buffer

    // Handle money stream frames
    for (let frame of requestFrames) {
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
          stream.on('_send', this.startSendLoop.bind(this))

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

    responseFrames.push(new PacketNumberFrame(packetNumber, PacketType.Fulfill))
    const responseData = this.encodeAndEncryptData(responseFrames)
    this.debug(`fulfilling prepare with fulfillment: ${fulfillment.toString('hex')}`)

    // Return fulfillment
    return {
      fulfillment,
      data: responseData
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
      try {
        await this.sendTestPacket()
      } catch (err) {
        this.debug('error sending test packet:', err)
        this.emit('error', err)

        // TODO should a connection error be an error on all of the streams?
        for (let msRecord of this.moneyStreams) {
          if (msRecord && !msRecord.sentClose) {
            msRecord.stream.emit('error', err)
          }
        }
        return
      }
    }

    while (this.sending) {
      // Send multiple packets at the same time (don't await promise)
      try {
        await this.sendPacket()
      } catch (err) {
        this.debug('error in sendPacket loop:', err)
        this.emit('error', err)

        // TODO should a connection error be an error on all of the streams?
        for (let msRecord of this.moneyStreams) {
          if (msRecord && !msRecord.sentClose) {
            msRecord.stream.emit('error', err)
          }
        }
      }

      // Figure out if we need to wait before sending the next one
    }
  }

  protected async sendPacket (): Promise<void> {
    this.debug('sendPacket')
    let amountToSend = new BigNumber(0)
    const requestFrames: Frame[] = []

    if (!this.destinationAccount) {
      this.debug('not sending because we do not know the client\'s address')
      return
    }

    // Set packet number to correlate response with request
    const packetNumber = this.outgoingPacketNumber++
    requestFrames.push(new PacketNumberFrame(packetNumber, 0))

    // Send control frames

    // Determine how much to send based on amount frames and path maximum packet amount
    let maxAmountFromStream = this.testMaximumPacketAmount
    const moneyStreamsSentFrom = []
    for (let msRecord of this.moneyStreams) {
      if (!msRecord || msRecord.sentClose) {
        // TODO just remove closed streams?
        continue
      }

      const amountToSendFromStream = msRecord.stream._holdOutgoing(packetNumber.toString(), maxAmountFromStream)
      if (amountToSendFromStream.isEqualTo(0)) {
        continue
      }

      const isEnd = msRecord.stream.isClosed() && msRecord.stream.amountOutgoing.isEqualTo(0)
      const frame = new StreamMoneyFrame(msRecord.id, amountToSendFromStream, isEnd)
      // TODO make sure the length of the frame's doesn't exceed packet data limit
      requestFrames.push(frame)
      amountToSend = amountToSend.plus(amountToSendFromStream)
      maxAmountFromStream = maxAmountFromStream.minus(amountToSendFromStream)

      msRecord.sentClose = isEnd || msRecord.sentClose
      moneyStreamsSentFrom.push(msRecord.stream)

      if (maxAmountFromStream.isEqualTo(0)) {
        break
      }
    }

    // Stop sending if there's no more to send
    // TODO don't stop if there's still data to send
    if (amountToSend.isEqualTo(0)) {
      this.sending = false
      return
    }

    // Set minimum destination amount
    if (this.exchangeRate) {
      const minimumDestinationAmount = amountToSend.times(this.exchangeRate)
        .times(new BigNumber(1).minus(this.slippage))
        .integerValue(BigNumber.ROUND_FLOOR)
      requestFrames.push(new MinimumDestinationAmountFrame(minimumDestinationAmount))
    }

    // Load packet data with available data frames (keep track of max data length)
    // TODO implement sending data

    // Encrypt
    const data = this.encodeAndEncryptData(requestFrames)

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
    this.debug(`sending packet number ${packetNumber}: ${JSON.stringify(prepare)}`)
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
      throw new Error(`Invalid response when sending packet: ${err.message}`)
    }

    // Handle fulfillment
    if (isFulfill(packet)) {
      if (!cryptoHelper.hash(packet.fulfillment).equals(executionCondition)) {
        this.debug(`got invalid fulfillment: ${packet.fulfillment.toString('hex')}. expected: ${fulfillment.toString('hex')} for condition: ${executionCondition.toString('hex')}`)
        throw new Error(`Got invalid fulfillment. Actual: ${packet.fulfillment.toString('hex')}, expected: ${fulfillment.toString('hex')}`)
      }
      for (let moneyStream of moneyStreamsSentFrom) {
        moneyStream._executeHold(packetNumber.toString())
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
    } else {
      // Handle reject

      // Put money back into MoneyStreams
      for (let moneyStream of moneyStreamsSentFrom) {
        moneyStream._cancelHold(packetNumber.toString())
      }

      if (packet.code !== 'F99') {
        return this.handleConnectorError(packet, amountToSend, this.sendPacket.bind(this))
      }
    }

    // Parse response data from receiver
    let responseFrames: Frame[] = []
    if (packet.data.length > 0) {
      try {
        const decrypted = cryptoHelper.decrypt(this.sharedSecret, packet.data)
        responseFrames = parseFrames(decrypted)
      } catch (err) {
        this.debug(`unable to decrypt and parse response data:`, err, packet.data.toString('hex'))
        // TODO should we continue processing anyway? what if it was fulfilled?
        throw new Error('Unable to decrypt and parse response data: ' + err.message)
      }
    }

    this.ensurePacketNumberMatches(responseFrames, packetNumber, (isFulfill(packet) ? PacketType.Fulfill : PacketType.Reject))

    // Handle response data from receiver
  }

  protected async sendTestPacket (amount?: BigNumber): Promise<void> {
    if (!this.destinationAccount) {
      throw new Error('Cannot send test packet. Destination account is unknown')
    }

    const requestFrames = []

    // Set packet number to correlate response with request
    const packetNumber = this.outgoingPacketNumber++
    requestFrames.push(new PacketNumberFrame(packetNumber, PacketType.Prepare))

    if (this.shouldSendSourceAccount) {
      // TODO attach a token to the account?
      requestFrames.push(new SourceAccountFrame(this.sourceAccount))

      // TODO make sure to reset this if the packet fails
      this.shouldSendSourceAccount = false
    }

    const sourceAmount = amount || BigNumber.minimum(TEST_PACKET_AMOUNT, this.testMaximumPacketAmount)
    this.debug(`sending test packet number: ${packetNumber} for amount: ${sourceAmount}`)
    const prepare = {
      destination: this.destinationAccount,
      amount: (sourceAmount).toString(),
      data: this.encodeAndEncryptData(requestFrames),
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

    if (reject.code !== 'F99') {
      return this.handleConnectorError(reject, sourceAmount, this.sendTestPacket.bind(this))
    }

    let responseFrames: Frame[]
    try {
      const decrypted = cryptoHelper.decrypt(this.sharedSecret, reject.data)
      responseFrames = parseFrames(decrypted)
    } catch (err) {
      this.debug(`unable to decrypt test packet response:`, err, reject.data.toString('hex'))
      throw new Error('Test packet response was corrupted')
    }

    this.ensurePacketNumberMatches(responseFrames, packetNumber, PacketType.Reject)

    for (let frame of responseFrames) {
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
  }

  protected handleConnectorError (reject: IlpPacket.IlpRejection, amountSent: BigNumber, retry: () => Promise<void>) {
    this.debug(`handling reject:`, JSON.stringify(reject))
    if (reject.code === 'F08') {
      let receivedAmount: BigNumber | undefined = undefined
      let maximumAmount: BigNumber | undefined = undefined
      if (reject.data.length >= 16) {
        try {
          const reader = Reader.from(reject.data)
          receivedAmount = reader.readUInt64BigNum()
          maximumAmount = reader.readUInt64BigNum()
        } catch (err) {}
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
      return retry()
    } else {
      this.debug(`unexpected error. code: ${reject.code}, message: ${reject.message}, data: ${reject.data.toString('hex')}`)
      throw new Error(`Unexpected response to packet: ${reject.code}`)
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

  protected ensurePacketNumberMatches (responseFrames: Frame[], packetNumber: BigNumber.Value, packetType: PacketType): void {
    // Check that response packet number matches outgoing number
    const packetNumberFrame = responseFrames.find(isPacketNumberFrame)
    if (!packetNumberFrame) {
      this.debug('packet did not include packet number frame, so we cannot be sure if the response matches the request', JSON.stringify(frames))
      throw new Error('Receiver did not respond with packet number frame')
    } else if (!packetNumberFrame.packetNumber.isEqualTo(packetNumber)) {
      this.debug(`packet response does not match request. actual response packet number: ${packetNumberFrame.packetNumber}, expected: ${packetNumber}`)
      throw new Error(`Packet response does not match packet number of request. Actual: ${packetNumberFrame.packetNumber}, expected: ${packetNumber}.`)
    } else if (packetNumberFrame.packetType !== packetType) {
      this.debug(`packet response does not have expected packet type. actual: ${packetNumberFrame.packetType}, expected: ${packetType}`)
      throw new Error(`Packet response does not have expected packet type. Actual: ${packetNumberFrame.packetType}, expected: ${packetType}`)
    }
  }
}

function isFulfill (packet: IlpPacket.IlpFulfill | IlpPacket.IlpRejection): packet is IlpPacket.IlpFulfill {
  return packet.hasOwnProperty('fulfillment')
}
