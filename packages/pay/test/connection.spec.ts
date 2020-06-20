/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-non-null-assertion */
import { it, expect } from '@jest/globals'
import { MirrorPlugin } from './helpers/plugin'
import { createConnection } from '../src/connection'
import { ControllerMap, StreamReject } from '../src/controllers'
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
} from 'ilp-packet'
import {
  generateFulfillment,
  generatePskEncryptionKey,
  generateFulfillmentKey,
  hash,
} from 'ilp-protocol-stream/dist/src/crypto'
import { IlpAddress, AssetScale } from '../src/utils'
import { Int, IlpError } from '../src/utils'
import { FailureController } from '../src/controllers/failure'
import { AccountController } from '../src/controllers/asset-details'

const destinationAddress = 'private.bob' as IlpAddress
const sharedSecret = randomBytes(32)

const controllers: ControllerMap = new Map()
controllers.set(
  AccountController,
  new AccountController(
    {
      ilpAddress: 'private.alice' as IlpAddress,
      assetScale: 2 as AssetScale,
      assetCode: 'ABC',
    },
    destinationAddress
  )
)
controllers.set(FailureController, new FailureController())

describe('handles requests', () => {
  it('acknowledges authentic incoming ILP Prepare packets', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    await createConnection(receiverPlugin, controllers, sharedSecret, destinationAddress)

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

    expect(ilpReply.code).toBe(IlpError.F99_APPLICATION_ERROR)

    const streamReply = await Packet.decryptAndDeserialize(encryptionKey, ilpReply.data)

    expect(streamReply.ilpPacketType).toBe(IlpPacketType.Reject)
    expect(+streamReply.prepareAmount).toBe(46)
    expect(+streamReply.sequence).toEqual(1)
    expect(streamReply.frames.length).toBe(0)
  })

  it('rejects incoming data that is not an ILP Prepare', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    await createConnection(receiverPlugin, controllers, sharedSecret, destinationAddress)

    const encryptionKey = await generatePskEncryptionKey(sharedSecret)

    const ilpReply = await senderPlugin
      .sendData(
        serializeIlpFulfill({
          fulfillment: randomBytes(32),
          data: randomBytes(50),
        })
      )
      .then(deserializeIlpReject)

    expect(ilpReply.code).toBe(IlpError.F01_INVALID_PACKET)

    const streamReply = Packet.decryptAndDeserialize(encryptionKey, ilpReply.data)
    await expect(streamReply).rejects.toBeInstanceOf(Error)
  })

  it('rejects incoming ILP Prepare packets that fail decryption', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    await createConnection(receiverPlugin, controllers, sharedSecret, destinationAddress)

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

    expect(ilpReply.code).toBe(IlpError.F06_UNEXPECTED_PAYMENT)

    const streamReply = Packet.decryptAndDeserialize(encryptionKey, ilpReply.data)
    await expect(streamReply).rejects.toBeInstanceOf(Error)
  })

  it('rejects incoming ILP Prepare packets with an invalid STREAM packet type', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    await createConnection(receiverPlugin, controllers, sharedSecret, destinationAddress)

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

    expect(ilpReply.code).toBe(IlpError.F99_APPLICATION_ERROR)

    const streamReply = Packet.decryptAndDeserialize(encryptionKey, ilpReply.data)
    await expect(streamReply).rejects.toBeInstanceOf(Error)
  })
})

describe('validates replies', () => {
  it('returns F01 if reply is not Fulfill or Reject', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    const connection = await createConnection(
      senderPlugin,
      controllers,
      sharedSecret,
      destinationAddress
    )

    receiverPlugin.registerDataHandler(async () =>
      serializeIlpPrepare({
        destination: 'private.foo',
        executionCondition: randomBytes(32),
        expiresAt: new Date(Date.now() + 10000),
        amount: '1',
        data: Buffer.alloc(0),
      })
    )

    const reply = await connection.sendRequest({
      sequence: 20,
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
      requestFrames: [],
      log: createLogger('ilp-pay'),
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

    const connection = await createConnection(
      senderPlugin,
      controllers,
      sharedSecret,
      destinationAddress,
      () => new Date(Date.now() + 3000) // Short expiry so test doesn't take forever
    )

    // Data handler never resolves
    receiverPlugin.registerDataHandler(() => new Promise(() => {}))

    const reply = await connection.sendRequest({
      sequence: 31,
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
      requestFrames: [],
      log: createLogger('ilp-pay'),
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

    const connection = await createConnection(
      senderPlugin,
      controllers,
      sharedSecret,
      destinationAddress
    )

    receiverPlugin.registerDataHandler(() => {
      throw new Error('Unable to process request')
    })

    const reply = await connection.sendRequest({
      sequence: 20,
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
      requestFrames: [],
      log: createLogger('ilp-pay'),
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

    const connection = await createConnection(
      senderPlugin,
      controllers,
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
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
      requestFrames: [],
      log: createLogger('ilp-pay'),
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

    const connection = await createConnection(
      senderPlugin,
      controllers,
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
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
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
      controllers,
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
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
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
      controllers,
      sharedSecret,
      destinationAddress
    )

    const replyData = randomBytes(100)
    receiverPlugin.registerDataHandler(async () =>
      serializeIlpReject({
        code: IlpError.F07_CANNOT_RECEIVE,
        message: '',
        triggeredBy: '',
        data: replyData,
      })
    )

    const reply = await connection.sendRequest({
      sequence: 1,
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
      requestFrames: [],
      log: createLogger('ilp-pay'),
    })

    // No STREAM packet could be decrypted
    expect(reply.destinationAmount).toBeUndefined()
    expect(reply.frames).toBeUndefined()

    expect(reply.isReject())
    expect((reply as StreamReject).ilpReject.code).toBe(IlpError.F07_CANNOT_RECEIVE)
    expect((reply as StreamReject).ilpReject.data).toEqual(replyData)
  })
})
