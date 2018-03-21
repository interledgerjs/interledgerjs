import EventEmitter3 = require('eventemitter3')
import * as Debug from 'debug'
import { MoneyStream } from './money-stream'
import * as IlpPacket from 'ilp-packet'
import * as cryptoHelper from './crypto'
import {
  Packet,
  Frame,
  StreamMoneyFrame,
  isStreamMoneyFrame,
  SourceAccountFrame,
  isSourceAccountFrame,
  AmountArrivedFrame,
  isAmountArrivedFrame,
  isMinimumDestinationAmountFrame,
  MinimumDestinationAmountFrame
} from './protocol'
import { Reader } from 'oer-utils'
import { Plugin } from './types'
import BigNumber from 'bignumber.js'
import 'source-map-support/register'

const TEST_PACKET_AMOUNT = new BigNumber(1000)
const RETRY_DELAY_START = 100

export interface ConnectionOpts {
  plugin: Plugin,
  destinationAccount?: string,
  sourceAccount: string,
  sharedSecret: Buffer,
  isServer: boolean,
  slippage?: BigNumber.Value
}

export class Connection extends EventEmitter3 {
  protected plugin: Plugin
  protected destinationAccount?: string
  protected sourceAccount: string
  protected sharedSecret: Buffer
  protected isServer: boolean
  protected slippage: BigNumber

  protected outgoingPacketNumber: number
  protected moneyStreams: MoneyStream[]
  protected nextStreamId: number
  protected debug: Debug.IDebugger
  protected sending: boolean
  /** Used to probe for the Maximum Packet Amount if the connectors don't tell us directly */
  protected testMaximumPacketAmount: BigNumber
  /** The path's Maximum Packet Amount, discovered through F08 errors */
  protected maximumPacketAmount: BigNumber
  protected closed: boolean
  /** Indicates whether we need to tell the other side our account (mostly for the client side on startup) */
  protected shouldSendSourceAccount: boolean
  protected exchangeRate?: BigNumber
  protected retryDelay: number

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
    this.retryDelay = RETRY_DELAY_START

    // TODO limit total amount buffered for all streams?
  }

  // TODO should this be async and resolve when it's connected?
  connect (): void {
    /* tslint:disable-next-line:no-floating-promises */
    this.startSendLoop()
  }

  createMoneyStream (): MoneyStream {
    // TODO should this inform the other side?
    const stream = new MoneyStream({
      id: this.nextStreamId,
      isServer: this.isServer
    })
    this.moneyStreams[this.nextStreamId] = stream
    this.debug(`created money stream: ${this.nextStreamId}`)
    this.nextStreamId += 2

    stream.on('_send', this.startSendLoop.bind(this))
    // TODO notify when the stream is closed

    return stream
  }

  /** @private */
  async handlePrepare (prepare: IlpPacket.IlpPrepare): Promise<IlpPacket.IlpFulfill> {
    this.debug(`got ILP Prepare:`, prepare)

    // Parse packet
    let requestPacket: Packet
    try {
      requestPacket = Packet.decryptAndDeserialize(this.sharedSecret, prepare.data)
    } catch (err) {
      this.debug(`error parsing frames:`, err)
      throw new IlpPacket.Errors.UnexpectedPaymentError('')
    }
    this.debug('handling packet:', JSON.stringify(requestPacket))

    if (requestPacket.ilpPacketType !== IlpPacket.Type.TYPE_ILP_PREPARE) {
      this.debug(`prepare packet contains a frame that says it should be something other than a prepare: ${requestPacket.ilpPacketType}`)
      throw new IlpPacket.Errors.UnexpectedPaymentError('')
    }

    const responseFrames: Frame[] = []

    // Tell sender how much arrived
    responseFrames.push(new AmountArrivedFrame(prepare.amount))

    const throwFinalApplicationError = () => {
      const responsePacket = new Packet(requestPacket.sequence, IlpPacket.Type.TYPE_ILP_REJECT, responseFrames)
      throw new IlpPacket.Errors.FinalApplicationError('', responsePacket.serializeAndEncrypt(this.sharedSecret))
    }

    // Handle non-money frames
    // (We'll use these even if the packet is unfulfillable)
    let totalMoneyShares = new BigNumber(0)
    const streamMoneyFrames: StreamMoneyFrame[] = []
    for (let frame of requestPacket.frames) {
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
        streamMoneyFrames.push(frame)

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
    for (let frame of streamMoneyFrames) {
      const streamId = frame.streamId.toNumber()

      // Handle new incoming MoneyStreams
      if (!this.moneyStreams[streamId]) {
        this.debug(`got new money stream: ${streamId}`)
        const stream = new MoneyStream({
          id: streamId,
          isServer: this.isServer
        })
        this.moneyStreams[streamId] = stream

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
      this.moneyStreams[streamId]._addToIncoming(amount)
    }

    const responsePacket = new Packet(requestPacket.sequence, IlpPacket.Type.TYPE_ILP_FULFILL, responseFrames)
    this.debug(`fulfilling prepare with fulfillment: ${fulfillment.toString('hex')}`)

    // Return fulfillment
    return {
      fulfillment,
      data: responsePacket.serializeAndEncrypt(this.sharedSecret)
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
        for (let moneyStream of this.moneyStreams) {
          if (moneyStream) {
            moneyStream.emit('error', err)
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
        this.sending = false
        this.debug('error in sendPacket loop:', err)
        this.emit('error', err)

        // TODO should a connection error be an error on all of the streams?
        for (let moneyStream of this.moneyStreams) {
          if (moneyStream && !moneyStream._sentClose) {
            moneyStream.emit('error', err)
          }
        }
      }

      // Figure out if we need to wait before sending the next one
    }
  }

  protected async sendPacket (): Promise<void> {
    this.debug('sendPacket')
    let amountToSend = new BigNumber(0)

    if (!this.destinationAccount) {
      this.debug('not sending because we do not know the client\'s address')
      return
    }

    // Set packet number to correlate response with request
    const requestPacket = new Packet(this.outgoingPacketNumber++, IlpPacket.Type.TYPE_ILP_PREPARE)

    // Send control frames

    // Determine how much to send based on amount frames and path maximum packet amount
    let maxAmountFromStream = this.testMaximumPacketAmount
    const moneyStreamsSentFrom = []
    for (let moneyStream of this.moneyStreams) {
      if (!moneyStream || moneyStream._sentClose) {
        // TODO just remove closed streams?
        continue
      }

      const amountToSendFromStream = moneyStream._holdOutgoing(requestPacket.sequence.toString(), maxAmountFromStream)
      if (amountToSendFromStream.isEqualTo(0)) {
        continue
      }

      const isEnd = moneyStream.isClosed() && moneyStream.amountOutgoing.isEqualTo(0)
      const frame = new StreamMoneyFrame(moneyStream.id, amountToSendFromStream, isEnd)
      // TODO make sure the length of the frame's doesn't exceed packet data limit
      requestPacket.frames.push(frame)
      amountToSend = amountToSend.plus(amountToSendFromStream)
      maxAmountFromStream = maxAmountFromStream.minus(amountToSendFromStream)

      moneyStream._sentClose = isEnd || moneyStream._sentClose
      moneyStreamsSentFrom.push(moneyStream)

      if (maxAmountFromStream.isEqualTo(0)) {
        // TODO make sure that we start with those later frames the next time around
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
      requestPacket.frames.push(new MinimumDestinationAmountFrame(minimumDestinationAmount))
    }

    // Load packet data with available data frames (keep track of max data length)
    // TODO implement sending data

    // Encrypt
    const data = requestPacket.serializeAndEncrypt(this.sharedSecret)

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
    this.debug(`sending packet number ${requestPacket.sequence}: ${JSON.stringify(prepare)}`)
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
      this.debug(`got invalid response from sendData:`, err, responseData.toString('hex'))
      throw new Error(`Invalid response when sending packet: ${err.message}`)
    }

    // Handle fulfillment
    if (isFulfill(response)) {
      if (!cryptoHelper.hash(response.fulfillment).equals(executionCondition)) {
        this.debug(`got invalid fulfillment: ${response.fulfillment.toString('hex')}. expected: ${fulfillment.toString('hex')} for condition: ${executionCondition.toString('hex')}`)
        throw new Error(`Got invalid fulfillment. Actual: ${response.fulfillment.toString('hex')}, expected: ${fulfillment.toString('hex')}`)
      }
      for (let moneyStream of moneyStreamsSentFrom) {
        moneyStream._executeHold(requestPacket.sequence.toString())
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
    } else {
      // Handle reject

      // Put money back into MoneyStreams
      for (let moneyStream of moneyStreamsSentFrom) {
        moneyStream._cancelHold(requestPacket.sequence.toString())
      }

      if (response.code !== 'F99') {
        return this.handleConnectorError(response, amountToSend, this.sendPacket.bind(this))
      }
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
    if (!responsePacket.sequence.isEqualTo(requestPacket.sequence)) {
      this.debug(`response packet sequence does not match the request packet. expected sequence: ${requestPacket.sequence}, got response packet:`, JSON.stringify(responsePacket))
      throw new Error(`Response packet sequence does not correspond to the request. Actual: ${responsePacket.sequence}, expected: ${requestPacket.sequence}`)
    }
    if (responsePacket.ilpPacketType !== responseData[0]) {
      this.debug(`response packet was on wrong ILP packet type. expected ILP packet type: ${responseData[0]}, got:`, JSON.stringify(responsePacket))
      throw new Error(`Response says it should be on an ILP packet of type: ${responsePacket.ilpPacketType} but it was carried on an ILP packet of type: ${responseData[0]}`)
    }

    // Handle response data from receiver
  }

  protected async sendTestPacket (amount?: BigNumber): Promise<void> {
    if (!this.destinationAccount) {
      throw new Error('Cannot send test packet. Destination account is unknown')
    }

    // Set packet number to correlate response with request
    const requestPacket = new Packet(this.outgoingPacketNumber++, IlpPacket.Type.TYPE_ILP_PREPARE, [])

    if (this.shouldSendSourceAccount) {
      // TODO attach a token to the account?
      requestPacket.frames.push(new SourceAccountFrame(this.sourceAccount))

      // TODO make sure to reset this if the packet fails
      this.shouldSendSourceAccount = false
    }

    const sourceAmount = amount || BigNumber.minimum(TEST_PACKET_AMOUNT, this.testMaximumPacketAmount)
    this.debug(`sending test packet number: ${requestPacket.sequence} for amount: ${sourceAmount}`)
    const prepare = {
      destination: this.destinationAccount,
      amount: (sourceAmount).toString(),
      data: requestPacket.serializeAndEncrypt(this.sharedSecret),
      executionCondition: cryptoHelper.generateRandomCondition(),
      expiresAt: new Date(Date.now() + 30000)
    }

    const responseData = await this.plugin.sendData(IlpPacket.serializeIlpPrepare(prepare))

    let response: IlpPacket.IlpRejection
    try {
      response = IlpPacket.deserializeIlpReject(responseData)
    } catch (err) {
      this.debug(`response is not an ILP Reject packet:`, responseData.toString('hex'))
      throw new Error('Response to sendTestPacket is not an ILP Reject packet')
    }

    if (response.code !== 'F99') {
      return this.handleConnectorError(response, sourceAmount, this.sendTestPacket.bind(this))
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
    if (!responsePacket.sequence.isEqualTo(requestPacket.sequence)) {
      this.debug(`response packet sequence does not match the request packet. expected sequence: ${requestPacket.sequence}, got response packet:`, JSON.stringify(responsePacket))
      throw new Error(`Response packet sequence does not correspond to the request. Actual: ${responsePacket.sequence}, expected: ${requestPacket.sequence}`)
    }
    if (responsePacket.ilpPacketType !== responseData[0]) {
      this.debug(`response packet was on wrong ILP packet type. expected ILP packet type: ${responseData[0]}, got:`, JSON.stringify(responsePacket))
      throw new Error(`Response says it should be on an ILP packet of type: ${responsePacket.ilpPacketType} but it was carried on an ILP packet of type: ${responseData[0]}`)
    }

    // Determine exchange rate from amount that arrived
    for (let frame of responsePacket.frames) {
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

  protected async handleConnectorError (reject: IlpPacket.IlpRejection, amountSent: BigNumber, retry: () => Promise<void>) {
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
      return retry()
    } else if (reject.code[0] === 'T') {
      this.debug(`got temporary error. waiting ${this.retryDelay} before trying again`)
      const delay = this.retryDelay
      this.retryDelay = this.retryDelay * 2
      await new Promise((resolve, reject) => setTimeout(resolve, delay))
      return retry()
    } else {
      this.debug(`unexpected error. code: ${reject.code}, message: ${reject.message}, data: ${reject.data.toString('hex')}`)
      throw new Error(`Unexpected error while sending packet. Code: ${reject.code}, message: ${reject.message}`)
    }
  }
}

function isFulfill (packet: IlpPacket.IlpFulfill | IlpPacket.IlpRejection): packet is IlpPacket.IlpFulfill {
  return packet.hasOwnProperty('fulfillment')
}
