/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-non-null-assertion */
import { it, expect } from '@jest/globals'
import { MirrorPlugin } from './helpers/plugin'
import { createConnection } from '../src/connection'
import { StreamReject } from '../src/controllers'
import { randomBytes } from 'crypto'
import {
  Packet,
  IlpPacketType,
  ConnectionMaxStreamIdFrame,
  ConnectionDataBlockedFrame,
} from 'ilp-protocol-stream/dist/src/packet'
import createLogger from 'ilp-logger'
import {
  serializeIlpReject,
  deserializeIlpPrepare,
  serializeIlpFulfill,
  serializeIlpPrepare,
  deserializeIlpReject,
  IlpPrepare,
  IlpAddress,
  IlpError,
} from 'ilp-packet'
import {
  generateFulfillment,
  generatePskEncryptionKey,
  generateFulfillmentKey,
} from 'ilp-protocol-stream/dist/src/crypto'
import { Int } from '../src/utils'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'

const destinationAddress = 'private.bob' as IlpAddress
const sharedSecret = randomBytes(32)
const expiresAt = new Date(Date.now() + 30000)
const log = createLogger('ilp-pay')

describe('handles requests', () => {
  it('rejects all incoming packets', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    await createConnection(receiverPlugin, sharedSecret)

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

    expect(ilpReply.code).toBe(IlpError.F02_UNREACHABLE)

    const streamReply = Packet.decryptAndDeserialize(encryptionKey, ilpReply.data)
    await expect(streamReply).rejects.toBeInstanceOf(Error)
  })
})

describe('validates replies', () => {
  it('returns F01 if reply is not Fulfill or Reject', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    const sendRequest = await createConnection(senderPlugin, sharedSecret)

    receiverPlugin.registerDataHandler(async () =>
      serializeIlpPrepare({
        destination: 'private.foo',
        executionCondition: randomBytes(32),
        expiresAt: new Date(Date.now() + 10000),
        amount: '1',
        data: Buffer.alloc(0),
      })
    )

    const reply = await sendRequest({
      destinationAddress,
      expiresAt,
      sequence: 20,
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
      requestFrames: [],
      log,
    })

    expect(reply.destinationAmount).toBeUndefined()
    expect(reply.frames).toBeUndefined()

    expect(reply.isReject())
    expect((reply as StreamReject).ilpReject.code).toBe(IlpError.F01_INVALID_PACKET)
  })

  it('returns R00 if packet times out', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    const sendRequest = await createConnection(senderPlugin, sharedSecret)

    // Data handler never resolves
    receiverPlugin.registerDataHandler(() => new Promise(() => {}))

    const reply = await sendRequest({
      destinationAddress,
      expiresAt: new Date(Date.now() + 1000), // Short expiry so test completes quickly
      sequence: 31,
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
      requestFrames: [],
      log,
    })

    expect(reply.destinationAmount).toBeUndefined()
    expect(reply.frames).toBeUndefined()

    expect(reply.isReject())
    expect((reply as StreamReject).ilpReject.code).toBe(IlpError.R00_TRANSFER_TIMED_OUT)
  })

  it('returns T00 if the plugin throws an error', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    const sendRequest = await createConnection(senderPlugin, sharedSecret)

    receiverPlugin.registerDataHandler(() => {
      throw new Error('Unable to process request')
    })

    const reply = await sendRequest({
      destinationAddress,
      expiresAt,
      sequence: 20,
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
      requestFrames: [],
      log,
    })

    expect(reply.destinationAmount).toBeUndefined()
    expect(reply.frames).toBeUndefined()

    expect(reply.isReject())
    expect((reply as StreamReject).ilpReject.code).toBe(IlpError.T00_INTERNAL_ERROR)
  })

  it('returns T00 if plugin is not connected', async () => {
    const plugin: Plugin = {
      async connect() {},
      async disconnect() {},
      isConnected() {
        return false
      },
      sendData() {
        // Promise never resolves
        return new Promise<Buffer>(() => {})
      },
      registerDataHandler() {},
      deregisterDataHandler() {},
    }

    const sendRequest = await createConnection(plugin, sharedSecret)

    const reply = await sendRequest({
      destinationAddress,
      expiresAt,
      sequence: 1000,
      sourceAmount: Int.ONE,
      minDestinationAmount: Int.ONE,
      isFulfillable: true,
      requestFrames: [],
      log,
    })

    expect(reply.destinationAmount).toBeUndefined()
    expect(reply.frames).toBeUndefined()

    expect(reply.isReject())
    expect((reply as StreamReject).ilpReject.code).toBe(IlpError.T00_INTERNAL_ERROR)
  })

  it('returns F05 on invalid fulfillment', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    const sendRequest = await createConnection(senderPlugin, sharedSecret)

    receiverPlugin.registerDataHandler(async () =>
      serializeIlpFulfill({
        fulfillment: randomBytes(32),
        data: Buffer.alloc(0),
      })
    )

    const reply = await sendRequest({
      destinationAddress,
      expiresAt,
      sequence: 20,
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
      requestFrames: [],
      log,
    })

    expect(reply.destinationAmount).toBeUndefined()
    expect(reply.frames).toBeUndefined()

    expect(reply.isReject())
    expect((reply as StreamReject).ilpReject.code).toBe(IlpError.F05_WRONG_CONDITION)
  })

  it('discards STREAM reply with invalid sequence', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    const encryptionKey = await generatePskEncryptionKey(sharedSecret)
    const fulfillmentKey = await generateFulfillmentKey(sharedSecret)

    const sendRequest = await createConnection(senderPlugin, sharedSecret)

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

    const reply = await sendRequest({
      destinationAddress,
      expiresAt,
      sequence: 20,
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
      requestFrames: [],
      log,
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

    const sendRequest = await createConnection(senderPlugin, sharedSecret)

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

    const reply = await sendRequest({
      destinationAddress,
      expiresAt,
      sequence: 1,
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
      requestFrames: [],
      log,
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

    const sendRequest = await createConnection(senderPlugin, sharedSecret)

    const replyData = randomBytes(100)
    receiverPlugin.registerDataHandler(async () =>
      serializeIlpReject({
        code: IlpError.F07_CANNOT_RECEIVE,
        message: '',
        triggeredBy: '',
        data: replyData,
      })
    )

    const reply = await sendRequest({
      destinationAddress,
      expiresAt,
      sequence: 1,
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
      requestFrames: [],
      log,
    })

    // No STREAM packet could be decrypted
    expect(reply.destinationAmount).toBeUndefined()
    expect(reply.frames).toBeUndefined()

    expect(reply.isReject())
    expect((reply as StreamReject).ilpReject.code).toBe(IlpError.F07_CANNOT_RECEIVE)
    expect((reply as StreamReject).ilpReject.data).toEqual(replyData)
  })
})
