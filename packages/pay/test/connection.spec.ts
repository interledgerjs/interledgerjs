import { it, expect } from '@jest/globals'
import { MirrorPlugin } from './plugin'
import { createConnection } from '../src/connection'
import { ControllerMap, StreamReject } from '../src/controllers'
import { randomBytes } from 'crypto'
import {
  Packet,
  IlpPacketType,
  ConnectionMaxStreamIdFrame,
  ConnectionDataBlockedFrame,
} from 'ilp-protocol-stream/dist/src/packet'
import BigNumber from 'bignumber.js'
import { Integer } from '../src/utils'
import createLogger from 'ilp-logger'
import {
  serializeIlpReject,
  Errors,
  deserializeIlpPrepare,
  serializeIlpFulfill,
  serializeIlpPrepare,
  deserializeIlpReject,
  IlpPrepare,
} from 'ilp-packet'
import {
  generateFulfillment,
  generatePskEncryptionKey,
  generateFulfillmentKey,
  hash,
} from 'ilp-protocol-stream/dist/src/crypto'
import { IlpAddress } from '../src/setup/shared'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { SequenceController } from '../src/controllers/sequence'

const destinationAddress = 'private.bob' as IlpAddress
const sharedSecret = randomBytes(32)

describe('handles requests', () => {
  it('acknowledges authentic incoming ILP Prepare packets', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    await createConnection(
      receiverPlugin,
      new Map() as ControllerMap,
      sharedSecret,
      destinationAddress
    )

    const encryptionKey = await generatePskEncryptionKey(sharedSecret)
    const fulfillmentKey = await generateFulfillmentKey(sharedSecret)

    const streamRequest = await new Packet(1, IlpPacketType.Prepare, 46).serializeAndEncrypt(
      encryptionKey
    )

    // Send this as a fulfillable packet to test/ensure that i's not fulfilled
    const fulfillment = await generateFulfillment(fulfillmentKey, streamRequest)
    const executionCondition = await hash(fulfillment)

    const ilpPrepare: IlpPrepare = {
      amount: '46',
      destination: destinationAddress,
      expiresAt: new Date(Date.now() + 30000),
      executionCondition,
      data: streamRequest,
    }

    const ilpReply = await senderPlugin
      .sendData(serializeIlpPrepare(ilpPrepare))
      .then(deserializeIlpReject)

    expect(ilpReply.code).toBe(Errors.codes.F99_APPLICATION_ERROR)

    const streamReply = await Packet.decryptAndDeserialize(encryptionKey, ilpReply.data)

    expect(streamReply.ilpPacketType).toBe(IlpPacketType.Reject)
    expect(+streamReply.prepareAmount).toBe(46)
    expect(+streamReply.sequence).toEqual(1)
    expect(streamReply.frames.length).toBe(0)
  })

  it('rejects incoming ILP Prepare packets that fail decryption', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    await createConnection(
      receiverPlugin,
      new Map() as ControllerMap,
      sharedSecret,
      destinationAddress
    )

    const encryptionKey = await generatePskEncryptionKey(sharedSecret)

    const ilpPrepare: IlpPrepare = {
      amount: '1000',
      destination: destinationAddress,
      expiresAt: new Date(Date.now() + 30000),
      executionCondition: randomBytes(32),
      data: randomBytes(200),
    }

    const ilpReply = await senderPlugin
      .sendData(serializeIlpPrepare(ilpPrepare))
      .then(deserializeIlpReject)

    expect(ilpReply.code).toBe(Errors.codes.F06_UNEXPECTED_PAYMENT)

    const streamReply = Packet.decryptAndDeserialize(encryptionKey, ilpReply.data)
    await expect(streamReply).rejects.toBeInstanceOf(Error)
  })

  it('rejects incoming ILP Prepare packets with an invalid STREAM packet type', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    await createConnection(
      receiverPlugin,
      new Map() as ControllerMap,
      sharedSecret,
      destinationAddress
    )

    const encryptionKey = await generatePskEncryptionKey(sharedSecret)

    const streamRequest = new Packet(1, IlpPacketType.Reject, 2333)

    const ilpPrepare: IlpPrepare = {
      amount: '46',
      destination: destinationAddress,
      expiresAt: new Date(Date.now() + 30000),
      executionCondition: randomBytes(32),
      data: await streamRequest.serializeAndEncrypt(encryptionKey),
    }

    const ilpReply = await senderPlugin
      .sendData(serializeIlpPrepare(ilpPrepare))
      .then(deserializeIlpReject)

    expect(ilpReply.code).toBe(Errors.codes.F99_APPLICATION_ERROR)

    const streamReply = Packet.decryptAndDeserialize(encryptionKey, ilpReply.data)
    await expect(streamReply).rejects.toBeInstanceOf(Error)
  })
})

describe('validates replies', () => {
  it('returns R00 if packet times out', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    const connection = await createConnection(
      senderPlugin,
      new Map() as ControllerMap,
      sharedSecret,
      destinationAddress,
      () => new Date(Date.now() + 3000) // Short expiry so test doesn't take forever
    )

    // Data handler never resolves
    receiverPlugin.registerDataHandler(() => new Promise(() => {}))

    const reply = await connection.sendRequest({
      sequence: 31,
      sourceAmount: new BigNumber(100) as Integer,
      minDestinationAmount: new BigNumber(99) as Integer,
      requestFrames: [],
      log: createLogger('ilp-pay'),
    })

    expect(reply.destinationAmount).toBeUndefined()
    expect(reply.frames).toBeUndefined()

    expect(reply.isReject())
    expect((reply as StreamReject).ilpReject.code).toBe(Errors.codes.R00_TRANSFER_TIMED_OUT)
  })

  it('returns T00 if the plugin throws an error', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    const connection = await createConnection(
      senderPlugin,
      new Map() as ControllerMap,
      sharedSecret,
      destinationAddress
    )

    receiverPlugin.registerDataHandler(() => {
      throw new Error('Unable to process request')
    })

    const reply = await connection.sendRequest({
      sequence: 20,
      sourceAmount: new BigNumber(100) as Integer,
      minDestinationAmount: new BigNumber(99) as Integer,
      requestFrames: [],
      log: createLogger('ilp-pay'),
    })

    expect(reply.destinationAmount).toBeUndefined()
    expect(reply.frames).toBeUndefined()

    expect(reply.isReject())
    expect((reply as StreamReject).ilpReject.code).toBe(Errors.codes.T00_INTERNAL_ERROR)
  })

  it('returns F05 on invalid fulfillment', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    const connection = await createConnection(
      senderPlugin,
      new Map() as ControllerMap,
      sharedSecret,
      destinationAddress
    )

    receiverPlugin.registerDataHandler(async () =>
      serializeIlpFulfill({
        fulfillment: randomBytes(32),
        data: Buffer.alloc(0),
      })
    )

    const reply = await connection.sendRequest({
      sequence: 20,
      sourceAmount: new BigNumber(100) as Integer,
      minDestinationAmount: new BigNumber(99) as Integer,
      requestFrames: [],
      log: createLogger('ilp-pay'),
    })

    expect(reply.destinationAmount).toBeUndefined()
    expect(reply.frames).toBeUndefined()

    expect(reply.isReject())
    expect((reply as StreamReject).ilpReject.code).toBe(Errors.codes.F05_WRONG_CONDITION)
  })

  it('discards STREAM reply with invalid sequence', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    const encryptionKey = await generatePskEncryptionKey(sharedSecret)
    const fulfillmentKey = await generateFulfillmentKey(sharedSecret)

    const connection = await createConnection(
      senderPlugin,
      new Map() as ControllerMap,
      sharedSecret,
      destinationAddress
    )

    receiverPlugin.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)

      const streamReply = new Packet(1, IlpPacketType.Fulfill, 100, [
        new ConnectionMaxStreamIdFrame(30), // Some random frame
      ])

      return serializeIlpFulfill({
        fulfillment: await generateFulfillment(fulfillmentKey, prepare.data),
        data: await streamReply.serializeAndEncrypt(encryptionKey),
      })
    })

    const reply = await connection.sendRequest({
      sequence: 20,
      sourceAmount: new BigNumber(100) as Integer,
      minDestinationAmount: new BigNumber(99) as Integer,
      requestFrames: [],
      log: createLogger('ilp-pay'),
    })

    // Discards reply since the sequence # is not the same as the request
    expect(reply.destinationAmount).toBeUndefined()
    expect(reply.frames).toBeUndefined()

    expect(reply.isFulfill())
  })

  it('discards STREAM reply if packet type is invalid', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    const encryptionKey = await generatePskEncryptionKey(sharedSecret)
    const fulfillmentKey = await generateFulfillmentKey(sharedSecret)

    const connection = await createConnection(
      senderPlugin,
      new Map() as ControllerMap,
      sharedSecret,
      destinationAddress
    )

    receiverPlugin.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)

      // Receiver is claiming the packet is a reject, even though it's a Fulfill
      const streamReply = new Packet(1, IlpPacketType.Reject, 100, [
        new ConnectionDataBlockedFrame(0), // Some random frame
      ])

      return serializeIlpFulfill({
        fulfillment: await generateFulfillment(fulfillmentKey, prepare.data),
        data: await streamReply.serializeAndEncrypt(encryptionKey),
      })
    })

    const reply = await connection.sendRequest({
      sequence: 1,
      sourceAmount: new BigNumber(100) as Integer,
      minDestinationAmount: new BigNumber(99) as Integer,
      requestFrames: [],
      log: createLogger('ilp-pay'),
    })

    // Discards reply since packet type was invalid
    expect(reply.destinationAmount).toBeUndefined()
    expect(reply.frames).toBeUndefined()

    expect(reply.isFulfill())
  })

  it('handles replies when decryption fails', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    const connection = await createConnection(
      senderPlugin,
      new Map() as ControllerMap,
      sharedSecret,
      destinationAddress
    )

    const replyData = randomBytes(100)
    receiverPlugin.registerDataHandler(async () =>
      serializeIlpReject({
        code: Errors.codes.F07_CANNOT_RECEIVE,
        message: '',
        triggeredBy: '',
        data: replyData,
      })
    )

    const reply = await connection.sendRequest({
      sequence: 1,
      sourceAmount: new BigNumber(100) as Integer,
      minDestinationAmount: new BigNumber(99) as Integer,
      requestFrames: [],
      log: createLogger('ilp-pay'),
    })

    // No STREAM packet could be decrypted
    expect(reply.destinationAmount).toBeUndefined()
    expect(reply.frames).toBeUndefined()

    expect(reply.isReject())
    expect((reply as StreamReject).ilpReject.code).toBe(Errors.codes.F07_CANNOT_RECEIVE)
    expect((reply as StreamReject).ilpReject.data).toEqual(replyData)
  })
})

it('catches plugin disconnect errors', async () => {
  const plugin: Plugin = {
    async connect() {},
    async disconnect() {
      throw new Error('Failed to disconnect')
    },
    async sendData() {
      return Buffer.alloc(0)
    },
    registerDataHandler() {},
    deregisterDataHandler() {},
    isConnected() {
      return true
    },
  }

  const controllers: ControllerMap = new Map().set(SequenceController, new SequenceController())

  const connection = await createConnection(plugin, controllers, sharedSecret, destinationAddress)

  await connection.close()
})
