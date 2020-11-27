/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-non-null-assertion */
import { expect, it } from '@jest/globals'
import { randomBytes } from 'crypto'
import createLogger from 'ilp-logger'
import {
  deserializeIlpPrepare,
  deserializeIlpReject,
  IlpAddress,
  IlpError,
  IlpPrepare,
  serializeIlpFulfill,
  serializeIlpPrepare,
  serializeIlpReject,
} from 'ilp-packet'
import {
  generateFulfillment,
  generateFulfillmentKey,
  generatePskEncryptionKey,
} from 'ilp-protocol-stream/dist/src/crypto'
import {
  ConnectionDataBlockedFrame,
  ConnectionMaxStreamIdFrame,
  IlpPacketType,
  Packet,
} from 'ilp-protocol-stream/dist/src/packet'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { createConnection, StreamConnection } from '../src/connection'
import { StreamReject } from '../src/request'
import { Int } from '../src/utils'
import { MirrorPlugin } from './helpers/plugin'
import { PaymentError } from '../src'

const destinationAddress = 'private.bob' as IlpAddress
const sharedSecret = randomBytes(32)
const expiresAt = new Date(Date.now() + 30000)
const log = createLogger('ilp-pay')

describe('connection', () => {
  it('catches error if plugin fails to connect', async () => {
    const plugin = {
      async connect() {
        throw new Error('Failed to connect')
      },
      async disconnect() {},
      async sendData() {
        return Buffer.alloc(0)
      },
      registerDataHandler() {},
      deregisterDataHandler() {},
      isConnected() {
        return true
      },
    }

    const error = (await createConnection(plugin, {
      sharedSecret,
      destinationAddress,
    })) as PaymentError
    expect(error).toBe(PaymentError.Disconnected)
  })

  it('times out if plugin never connects', async () => {
    const plugin = {
      connect() {
        return new Promise<void>(() => {})
      },
      async disconnect() {},
      async sendData() {
        return Buffer.alloc(0)
      },
      registerDataHandler() {},
      deregisterDataHandler() {},
      isConnected() {
        return true
      },
    }

    const error = (await createConnection(plugin, {
      sharedSecret,
      destinationAddress,
    })) as PaymentError
    expect(error).toBe(PaymentError.Disconnected)
  }, 15_000)

  it('catches plugin disconnect errors', async () => {
    const plugin = {
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

    const { close } = (await createConnection(plugin, {
      sharedSecret,
      destinationAddress,
    })) as StreamConnection
    await close()
  })

  it('times out if plugin never disconnects', async () => {
    const plugin = {
      async connect() {},
      disconnect() {
        return new Promise<void>(() => {})
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

    const { close } = (await createConnection(plugin, {
      sharedSecret,
      destinationAddress,
    })) as StreamConnection
    await close()
  }, 10_000)

  it('rejects all incoming packets', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    await senderPlugin.connect()
    await receiverPlugin.connect()

    await createConnection(receiverPlugin, {
      sharedSecret,
      destinationAddress,
    })

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

    const { sendRequest } = (await createConnection(senderPlugin, {
      sharedSecret,
      destinationAddress,
    })) as StreamConnection

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
      frames: [],
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

    const { sendRequest } = (await createConnection(senderPlugin, {
      sharedSecret,
      destinationAddress,
    })) as StreamConnection

    // Data handler never resolves
    receiverPlugin.registerDataHandler(() => new Promise(() => {}))

    const reply = await sendRequest({
      destinationAddress,
      expiresAt: new Date(Date.now() + 1000), // Short expiry so test completes quickly
      sequence: 31,
      sourceAmount: Int.from(100)!,
      minDestinationAmount: Int.from(99)!,
      isFulfillable: true,
      frames: [],
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

    const { sendRequest } = (await createConnection(senderPlugin, {
      sharedSecret,
      destinationAddress,
    })) as StreamConnection

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
      frames: [],
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

    const { sendRequest } = (await createConnection(plugin, {
      sharedSecret,
      destinationAddress,
    })) as StreamConnection

    const reply = await sendRequest({
      destinationAddress,
      expiresAt,
      sequence: 1000,
      sourceAmount: Int.ONE,
      minDestinationAmount: Int.ONE,
      isFulfillable: true,
      frames: [],
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

    const { sendRequest } = (await createConnection(senderPlugin, {
      sharedSecret,
      destinationAddress,
    })) as StreamConnection

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
      frames: [],
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

    const { sendRequest } = (await createConnection(senderPlugin, {
      sharedSecret,
      destinationAddress,
    })) as StreamConnection

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
      frames: [],
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

    const { sendRequest } = (await createConnection(senderPlugin, {
      sharedSecret,
      destinationAddress,
    })) as StreamConnection

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
      frames: [],
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

    const { sendRequest } = (await createConnection(senderPlugin, {
      sharedSecret,
      destinationAddress,
    })) as StreamConnection

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
      frames: [],
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
