/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable prefer-const */
import { createApp } from 'ilp-connector'
import {
  createBalanceTracker,
  createMaxPacketMiddleware,
  createPlugin,
  createRateMiddleware,
  createSlippageMiddleware,
  createStreamReceiver,
  MirrorPlugin,
} from './helpers/plugin'
import { CustomBackend } from './helpers/rate-backend'
import reduct from 'reduct'
import { Connection, createReceipt, createServer, DataAndMoneyStream } from 'ilp-protocol-stream'
import Long from 'long'
import { Ratio, Int, PaymentError, setupPayment } from '../src'
import { expect, describe, it } from '@jest/globals'
import {
  generateFulfillment,
  generateFulfillmentKey,
  generatePskEncryptionKey,
  hash,
  randomBytes,
} from 'ilp-protocol-stream/dist/src/crypto'
import {
  deserializeIlpPrepare,
  IlpAddress,
  IlpError,
  isFulfill,
  isIlpReply,
  serializeIlpFulfill,
  serializeIlpReject,
  serializeIlpReply,
} from 'ilp-packet'
import { StreamServer } from '@interledger/stream-receiver'
import { sleep } from '../src/utils'
import {
  ConnectionAssetDetailsFrame,
  IlpPacketType,
  Packet,
  StreamReceiptFrame,
} from 'ilp-protocol-stream/dist/src/packet'
import { Writer } from 'oer-utils'
import { RequestBuilder } from '../src/request'
import { SendStateType } from '../src/controllers'
import { PaymentController } from '../src/controllers/payment'
import { SequenceController } from '../src/controllers/sequence'
import createLogger from 'ilp-logger'

const streamServer = new StreamServer({
  serverSecret: randomBytes(32),
  serverAddress: 'private.larry',
})
const streamReceiver = createStreamReceiver(streamServer)

describe('fixed source payments', () => {
  it('completes source amount payment with max packet amount', async () => {
    const [alice1, alice2] = MirrorPlugin.createPair()
    const [bob1, bob2] = MirrorPlugin.createPair()

    const prices = {
      USD: 1,
      XRP: 0.2041930991198592,
    }

    // Override with rate backend for custom rates
    let backend: CustomBackend
    const deps = reduct((Constructor) => Constructor.name === 'RateBackend' && backend)
    backend = new CustomBackend(deps)
    backend.setPrices(prices)

    const app = createApp(
      {
        ilpAddress: 'test.larry',
        spread: 0.014, // 1.4% slippage
        accounts: {
          alice: {
            relation: 'child',
            plugin: alice2,
            assetCode: 'USD',
            assetScale: 6,
            maxPacketAmount: '5454',
          },
          bob: {
            relation: 'child',
            plugin: bob1,
            assetCode: 'XRP',
            assetScale: 9,
          },
        },
      },
      deps
    )
    await app.listen()

    const streamServer = await createServer({
      plugin: bob2,
    })

    const connectionPromise = streamServer.acceptConnection()
    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Long.MAX_UNSIGNED_VALUE)
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const amountToSend = BigInt(100427)
    const resolved = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })
    const { pay, ...quoteDetails } = await resolved.startQuote({
      amountToSend,
      sourceAsset: {
        code: 'USD',
        scale: 6,
      },
      slippage: 0.015,
      prices,
    })

    expect(resolved.destinationAsset).toEqual({
      code: 'XRP',
      scale: 9,
    })
    expect(resolved.destinationAddress).toBe(destinationAddress)
    expect(quoteDetails.maxSourceAmount.value).toBe(amountToSend)

    const receipt = await pay()

    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent.value).toBe(amountToSend)

    const serverConnection = await connectionPromise
    expect(BigInt(serverConnection.totalReceived)).toBe(receipt.amountDelivered.value)

    await app.shutdown()
    await streamServer.close()
  }, 10_000)

  it('completes source amount payment if exchange rate is very close to minimum', async () => {
    const [senderPlugin1, finalPacketPlugin] = MirrorPlugin.createPair()

    const senderPlugin2 = new MirrorPlugin()
    senderPlugin2.mirror = senderPlugin1

    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const prices = {
      BTC: 9814.04,
      EUR: 1.13,
    }

    // Override with rate backend for custom rates
    let backend: CustomBackend
    const deps = reduct((Constructor) => Constructor.name === 'RateBackend' && backend)
    backend = new CustomBackend(deps)
    backend.setPrices(prices)

    const app = createApp(
      {
        ilpAddress: 'private.larry',
        spread: 0,
        accounts: {
          sender: {
            relation: 'child',
            assetCode: 'BTC',
            assetScale: 8,
            plugin: senderPlugin2,
            maxPacketAmount: '1000',
          },
          receiver: {
            relation: 'child',
            assetCode: 'EUR',
            assetScale: 4,
            plugin: receiverPlugin1,
          },
        },
      },
      deps
    )
    await app.listen()

    const streamServer = await createServer({
      plugin: receiverPlugin2,
    })

    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Infinity)
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    // On the final packet, reject. This tests that the delivery shortfall
    // correctly gets refunded, and after the packet is retried,
    // the payment completes.
    let failedOnFinalPacket = false
    finalPacketPlugin.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)
      if (prepare.amount === '2' && !failedOnFinalPacket) {
        failedOnFinalPacket = true
        return serializeIlpReject({
          code: IlpError.T02_PEER_BUSY,
          message: '',
          triggeredBy: '',
          data: Buffer.alloc(0),
        })
      } else {
        return senderPlugin2.dataHandler(data)
      }
    })

    const { startQuote: quote } = await setupPayment({
      plugin: senderPlugin1,
      destinationAddress,
      sharedSecret,
    })
    const { pay, ...details } = await quote({
      // Send 100,002 sats
      // Max packet amount of 1000 means the final packet will try to send 2 units
      // This rounds down to 0, but the delivery shortfall should ensure this is acceptable
      amountToSend: 100_002,
      sourceAsset: {
        code: 'BTC',
        scale: 8,
      },
      slippage: 0.002,
      prices,
    })
    expect(details.maxSourceAmount.value).toBe(BigInt(100002))

    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent.value).toBe(BigInt(100002))
    expect(receipt.amountDelivered.value).toBeGreaterThanOrEqual(details.minDeliveryAmount.value)

    await app.shutdown()
    await streamServer.close()
  })

  it('complete source amount payment with no latency', async () => {
    const [alice1, alice2] = MirrorPlugin.createPair(0, 0)
    const [bob1, bob2] = MirrorPlugin.createPair(0, 0)

    const app = createApp({
      ilpAddress: 'test.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        alice: {
          relation: 'child',
          plugin: alice2,
          assetCode: 'XYZ',
          assetScale: 0,
          maxPacketAmount: '1',
        },
        bob: {
          relation: 'child',
          plugin: bob1,
          assetCode: 'XYZ',
          assetScale: 0,
        },
      },
    })
    await app.listen()

    // Waiting before fulfilling packets tests whether the number of packets in-flight is capped
    // and tests the greatest number of packets that are sent in-flight at once
    let numberPacketsInFlight = 0
    let highestNumberPacketsInFlight = 0
    const streamServer = await createServer({
      plugin: bob2,
      shouldFulfill: async () => {
        numberPacketsInFlight++
        await sleep(1000)
        highestNumberPacketsInFlight = Math.max(highestNumberPacketsInFlight, numberPacketsInFlight)
        numberPacketsInFlight--
      },
    })

    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Long.MAX_UNSIGNED_VALUE)
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    // Send 100 total packets
    const { startQuote: quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })
    const { pay } = await quote({
      amountToSend: 100,
      sourceAsset: {
        code: 'XYZ',
        scale: 0,
      },
      slippage: 1,
      prices: {},
    })

    const receipt = await pay()

    expect(receipt.error).toBeUndefined()
    expect(highestNumberPacketsInFlight).toBe(20)
    expect(receipt.amountSent.value).toBe(BigInt(100))

    await app.shutdown()
    await streamServer.close()
  }, 10_000)

  it('completes source amount payment with no rate enforcement', async () => {
    const [alice1, alice2] = MirrorPlugin.createPair()
    const [bob1, bob2] = MirrorPlugin.createPair()

    const prices = {
      ABC: 3.2,
      XYZ: 1.5,
    }

    // Override with rate backend for custom rates
    let backend: CustomBackend
    const deps = reduct((Constructor) => Constructor.name === 'RateBackend' && backend)
    backend = new CustomBackend(deps)
    backend.setPrices(prices)

    const app = createApp(
      {
        ilpAddress: 'test.larry',
        spread: 0.014, // 1.4% slippage
        accounts: {
          alice: {
            relation: 'child',
            plugin: alice2,
            assetCode: 'ABC',
            assetScale: 0,
            maxPacketAmount: '1000',
          },
          bob: {
            relation: 'child',
            plugin: bob1,
            assetCode: 'XYZ',
            assetScale: 0,
          },
        },
      },
      deps
    )
    await app.listen()

    const streamServer = await createServer({
      plugin: bob2,
    })

    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Long.MAX_UNSIGNED_VALUE)
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const { startQuote: quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })
    const amountToSend = BigInt(10_000)
    const { pay, minExchangeRate } = await quote({
      amountToSend,
      sourceAsset: {
        code: 'ABC',
        scale: 0,
      },
      slippage: 1, // Disables rate enforcement
      prices,
    })
    expect(minExchangeRate).toEqual(Ratio.of(Int.ZERO, Int.ONE))

    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent.value).toBe(amountToSend)
    expect(receipt.amountDelivered.value).toBeGreaterThan(BigInt(0))

    await app.shutdown()
    await streamServer.close()
  })
})

describe('fixed delivery payments', () => {
  it('delivers fixed destination amount with max packet amount', async () => {
    // Internal rate: 0.1
    // Real rate after rounding error: 0.096875, or 320/31
    const balanceTracker = createBalanceTracker()
    const plugin = createPlugin(
      createMaxPacketMiddleware(Int.from(320)!), // Rounding error: 1/320 => 0.003125
      createRateMiddleware({ code: 'USD', scale: 6 }, { code: 'USD', scale: 5 }, {}, 0.01),
      balanceTracker.middleware,
      streamReceiver
    )

    // Setup a three packet payment: 320 delivers 31, 320 delivers 31, 11 delivers 1.
    // This forces the final packet to be 1 unit, which tests the delivery deficit
    // logic since that packet wouldn't otherwise meet the minimum exchange rate.

    const amountToDeliver = Int.from(63)!
    const { sharedSecret, ilpAddress: destinationAddress } = streamServer.generateCredentials()

    const { startQuote: quote } = await setupPayment({
      destinationAddress,
      destinationAsset: {
        code: 'USD',
        scale: 5,
      },
      sharedSecret,
      plugin,
    })
    const { pay, maxSourceAmount } = await quote({
      amountToDeliver,
      sourceAsset: {
        code: 'USD',
        scale: 6,
      },
      slippage: 0.03125,
    })

    const receipt = await pay({
      // Tests progress handler logic
      progressHandler: (receipt) => {
        expect(
          receipt.sourceAmountInFlight.add(receipt.amountSent).isLessThanOrEqualTo(maxSourceAmount)
        )
        expect(balanceTracker.totalReceived().value).toBeGreaterThanOrEqual(
          receipt.amountDelivered.value
        )
      },
    })

    expect(receipt.error).toBeUndefined()

    expect(balanceTracker.totalReceived().value).toBe(amountToDeliver.value)
    expect(receipt.amountDelivered.value).toBe(amountToDeliver.value)

    // Ensures this tests the edge case of the overdelivery logic
    // so the amount sent is exactly the maximum value quoted
    expect(receipt.amountSent.value).toEqual(maxSourceAmount.value)
  }, 10_000)

  it('delivers single-shot fixed destination amount with single-shot', async () => {
    const plugin = createPlugin(
      createRateMiddleware({ code: 'USD', scale: 5 }, { code: 'USD', scale: 6 }, {}, 0.031249),
      createStreamReceiver(streamServer)
    )

    const { sharedSecret, ilpAddress: destinationAddress } = streamServer.generateCredentials()

    const amountToDeliver = Int.from(630)!
    const { startQuote: quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin,
      destinationAsset: {
        code: 'USD',
        scale: 6,
      },
    })
    const { pay, maxSourceAmount, minDeliveryAmount, minExchangeRate } = await quote({
      amountToDeliver,
      sourceAsset: {
        code: 'USD',
        scale: 5,
      },
      slippage: 0.03125,
    })

    const receipt = await pay()
    expect(receipt.amountSent).toEqual(maxSourceAmount)
    expect(receipt.amountDelivered.isGreaterThanOrEqualTo(amountToDeliver))

    // Allowed delivery amount doesn't allow *too much* to be delivered
    const maxDeliveryAmount = minDeliveryAmount.add(minExchangeRate.ceil())
    expect(receipt.amountDelivered.isLessThanOrEqualTo(maxDeliveryAmount))
  })

  it('delivers fixed destination amount with exchange rate greater than 1', async () => {
    const prices = {
      USD: 1,
      EUR: 1.0805787579827757,
      BTC: 9290.22557286273,
      ETH: 208.46218430418685,
      XRP: 0.2199704769864391,
      JPY: 0.00942729201037,
      GBP: 1.2344993179391268,
    }

    // More complex topology with multiple conversions and sources of rounding error:
    // BTC 8 -> USD 6 -> XRP 9
    const balanceTracker = createBalanceTracker()
    const plugin = createPlugin(
      // Tests multiple max packet amounts will get reduced
      createMaxPacketMiddleware(Int.from(2_000_000)!), // 0.02 BTC (larger than $0.01)
      createRateMiddleware({ code: 'BTC', scale: 8 }, { code: 'USD', scale: 6 }, prices, 0.005),

      // Tests correct max packet amount computation in remote asset
      createMaxPacketMiddleware(Int.from(10_000)!), // $0.01
      createRateMiddleware({ code: 'USD', scale: 6 }, { code: 'XRP', scale: 9 }, prices, 0.0031),

      balanceTracker.middleware,
      streamReceiver
    )

    const { sharedSecret, ilpAddress: destinationAddress } = streamServer.generateCredentials()

    // (1 - 0.031) * (1 - 0.005) => 0.9919155

    // Connector spread: 0.80845%
    // Sender accepts up to: 0.85%

    const amountToDeliver = Int.from(10_000_000_000)! // 10 XRP, ~$2 at given prices
    const { startQuote: quote } = await setupPayment({
      destinationAddress,
      destinationAsset: {
        code: 'XRP',
        scale: 9,
      },
      sharedSecret,
      plugin,
    })
    const { pay, maxSourceAmount, minExchangeRate } = await quote({
      amountToDeliver,
      sourceAsset: {
        code: 'BTC',
        scale: 8,
      },
      slippage: 0.0085,
      prices,
    })

    const receipt = await pay()

    expect(receipt.error).toBeUndefined()

    expect(receipt.amountDelivered.value).toBe(balanceTracker.totalReceived().value)
    expect(receipt.amountDelivered.value).toBeGreaterThanOrEqual(amountToDeliver.value)

    // Ensure over-delivery is minimized to the equivalent of a single source unit, 1 satoshi,
    // converted into destination units, drops of XRP:
    const maxDeliveryAmount = amountToDeliver.add(minExchangeRate.ceil())
    expect(receipt.amountDelivered.value).toBeLessThanOrEqual(maxDeliveryAmount.value)
    expect(receipt.amountSent.value).toBeLessThanOrEqual(maxSourceAmount.value)
  }, 10_000)

  it('fails if receive max is incompatible on fixed delivery payment', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 4,
          plugin: senderPlugin2,
        },
        receiver: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 4,
          plugin: receiverPlugin1,
        },
      },
    })
    await app.listen()

    const streamServer = await createServer({
      plugin: receiverPlugin2,
    })

    // Stream can receive up to 98, but we want to deliver 100
    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(98)
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const { startQuote: quote } = await setupPayment({
      plugin: senderPlugin1,
      destinationAddress,
      sharedSecret,
    })
    const { pay } = await quote({
      amountToDeliver: Int.from(100_0000),
      sourceAsset: {
        code: 'ABC',
        scale: 4,
      },
    })

    // Note: ilp-protocol-stream only returns `StreamMaxMoney` if the packet sent money, so it can't error during the quoting flow!
    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.IncompatibleReceiveMax)

    await app.shutdown()
    await streamServer.close()
  })

  it('fails if minimum exchange rate is 0 and cannot enforce delivery', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      defaultRoute: 'receiver',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 4,
          plugin: senderPlugin2,
        },
        receiver: {
          relation: 'child',
          assetCode: 'XYZ',
          assetScale: 2,
          plugin: receiverPlugin1,
        },
      },
    })
    await app.listen()

    const streamServer = await createServer({
      plugin: receiverPlugin2,
    })

    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Infinity)
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const { startQuote: quote } = await setupPayment({
      plugin: senderPlugin1,
      destinationAddress,
      sharedSecret,
    })
    await expect(
      quote({
        amountToDeliver: Int.from(100_0000),
        sourceAsset: {
          code: 'ABC',
          scale: 4,
        },
        slippage: 1,
        prices: {
          ABC: 1,
          XYZ: 1,
        },
      })
    ).rejects.toBe(PaymentError.UnenforceableDelivery)

    await app.shutdown()
    await streamServer.close()
  })

  it('accounts for fulfilled packets even if data is corrupted', async () => {
    const plugin = createPlugin(
      createMaxPacketMiddleware(Int.from(20)!),
      createSlippageMiddleware(0.01),
      async (prepare, next) => {
        // Strip data from Fulfills, track total received
        const reply = await next(prepare)
        if (isFulfill(reply)) {
          return { ...reply, data: randomBytes(200) }
        } else {
          return reply
        }
      },
      streamReceiver
    )

    const asset = {
      code: 'ABC',
      scale: 0,
    }

    const { sharedSecret, ilpAddress: destinationAddress } = streamServer.generateCredentials()

    const { startQuote: quote } = await setupPayment({
      plugin,
      destinationAddress,
      destinationAsset: asset,
      sharedSecret,
    })
    const { pay, maxSourceAmount } = await quote({
      // Amount much larger than max packet, so test will fail unless sender fails fast
      amountToDeliver: Int.from(1000000),
      sourceAsset: asset,
      slippage: 0.1,
    })

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.ReceiverProtocolViolation)
    expect(receipt.amountDelivered.value).toBe(BigInt(18)) // 20 unit packet, 1% slippage, minus 1 source unit
    expect(receipt.amountSent.value).toBeLessThanOrEqual(maxSourceAmount.value)
  }, 10_000)

  it('accounts for delivered amounts if the recipient claims to receive less than minimum', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 0,
          plugin: senderPlugin2,
          maxPacketAmount: '20',
        },
        receiver: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 0,
          plugin: receiverPlugin1,
        },
      },
    })
    await app.listen()

    const destinationAddress = 'private.larry.receiver'
    const sharedSecret = randomBytes(32)

    const encryptionKey = await generatePskEncryptionKey(sharedSecret)
    const fulfillmentKey = await generateFulfillmentKey(sharedSecret)

    // STREAM "receiver" that fulfills packets
    let totalReceived = BigInt(0)
    receiverPlugin2.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)

      const fulfillment = await generateFulfillment(fulfillmentKey, prepare.data)
      const isFulfillable = prepare.executionCondition.equals(await hash(fulfillment))

      const streamPacket = await Packet.decryptAndDeserialize(encryptionKey, prepare.data)

      if (isFulfillable) {
        // On fulfillable packets, fulfill, but lie and say we only received 1 unit
        totalReceived += Int.from(streamPacket.prepareAmount)!.value
        const streamReply = new Packet(streamPacket.sequence, IlpPacketType.Fulfill, 1)
        return serializeIlpFulfill({
          fulfillment,
          data: await streamReply.serializeAndEncrypt(encryptionKey),
        })
      } else {
        // On test packets, reject and ACK as normal so the quote succeeds
        const reject = new Packet(streamPacket.sequence, IlpPacketType.Reject, prepare.amount, [
          new ConnectionAssetDetailsFrame('ABC', 0),
        ])
        return serializeIlpReject({
          code: IlpError.F99_APPLICATION_ERROR,
          message: '',
          triggeredBy: '',
          data: await reject.serializeAndEncrypt(encryptionKey),
        })
      }
    })

    const { startQuote: quote } = await setupPayment({
      plugin: senderPlugin1,
      destinationAddress,
      sharedSecret,
    })
    const { pay, maxSourceAmount } = await quote({
      // Amount much larger than max packet, so test will fail unless sender fails fast
      amountToDeliver: Int.from(100000),
      sourceAsset: {
        code: 'ABC',
        scale: 0,
      },
      slippage: 0.2,
    })

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.ReceiverProtocolViolation)
    expect(receipt.amountDelivered.value).toEqual(totalReceived)
    expect(receipt.amountSent.value).toBeLessThanOrEqual(maxSourceAmount.value)

    await app.shutdown()
  })

  it('fails if the exchange rate drops to 0 during payment', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const prices = {
      USD: 1,
      EUR: 1.13,
    }

    // Override with rate backend for custom rates
    let backend: CustomBackend
    const deps = reduct((Constructor) => Constructor.name === 'RateBackend' && backend)
    backend = new CustomBackend(deps)
    backend.setPrices(prices)

    const app = createApp(
      {
        ilpAddress: 'test.larry',
        spread: 0.01, // 1% spread
        accounts: {
          alice: {
            relation: 'child',
            plugin: senderPlugin2,
            assetCode: 'USD',
            assetScale: 4,
            maxPacketAmount: '10000', // $1
          },
          bob: {
            relation: 'child',
            plugin: receiverPlugin1,
            assetCode: 'EUR',
            assetScale: 4,
          },
        },
      },
      deps
    )
    await app.listen()

    const streamServer = await createServer({
      plugin: receiverPlugin2,
    })

    const connectionPromise = streamServer.acceptConnection()
    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Infinity)
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const { startQuote: quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: senderPlugin1,
    })
    const { pay } = await quote({
      amountToDeliver: Int.from(10_0000), // 10 EUR
      sourceAsset: {
        code: 'USD',
        scale: 4,
      },
      slippage: 0.015, // 1.5% slippage allowed
      prices,
    })

    const serverConnection = await connectionPromise

    // Change exchange rate to 0 before the payment begins
    backend.setSpread(1)

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.InsufficientExchangeRate)
    expect(receipt.amountSent.value).toBe(BigInt(0))
    expect(receipt.amountDelivered.value).toBe(BigInt(0))
    expect(serverConnection.totalReceived).toBe('0')

    await app.shutdown()
    await streamServer.close()
  })

  it('fails if the exchange rate drops below the minimum during the payment', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair(200, 200)
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair(200, 200)

    const prices = {
      USD: 1,
      EUR: 1.13,
    }

    // Override with rate backend for custom rates
    let backend: CustomBackend
    const deps = reduct((Constructor) => Constructor.name === 'RateBackend' && backend)
    backend = new CustomBackend(deps)
    backend.setPrices(prices)

    const app = createApp(
      {
        ilpAddress: 'test.larry',
        spread: 0.01, // 1% spread
        accounts: {
          alice: {
            relation: 'child',
            plugin: senderPlugin2,
            assetCode: 'USD',
            assetScale: 4,
            maxPacketAmount: '10000', // $1
          },
          bob: {
            relation: 'child',
            plugin: receiverPlugin1,
            assetCode: 'EUR',
            assetScale: 4,
          },
        },
      },
      deps
    )
    await app.listen()

    const streamServer = await createServer({
      plugin: receiverPlugin2,
    })

    const connectionPromise = streamServer.acceptConnection()
    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Infinity)

        stream.on('money', () => {
          // Change exchange rate so it's just below the minimum
          // Only the first packets that have already been routed will be delivered
          backend.setSpread(0.016)
        })
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const { startQuote: quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: senderPlugin1,
    })
    const { pay, maxSourceAmount } = await quote({
      amountToDeliver: Int.from(100_000), // 10 EUR
      sourceAsset: {
        code: 'USD',
        scale: 4,
      },
      slippage: 0.015, // 1.5% slippage allowed
      prices,
    })

    const serverConnection = await connectionPromise

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.InsufficientExchangeRate)
    expect(receipt.amountDelivered.value).toBeLessThan(BigInt(100_000))
    expect(receipt.amountDelivered.value).toBe(BigInt(serverConnection.totalReceived))
    expect(receipt.amountSent.value).toBeLessThanOrEqual(maxSourceAmount.value)

    await app.shutdown()
    await streamServer.close()
  })
})

describe('payment execution', () => {
  it('fails on final Reject errors', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    const asset = {
      code: 'ABC',
      scale: 0,
    }
    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        default: {
          relation: 'child',
          assetCode: asset.code,
          assetScale: asset.scale,
          plugin: receiverPlugin,
        },
      },
    })
    await app.listen()

    const { startQuote: quote } = await setupPayment({
      plugin: senderPlugin,
      destinationAddress: 'private.unknown', // Non-routable address
      destinationAsset: asset,
      sharedSecret: Buffer.alloc(32),
    })
    await expect(
      quote({
        amountToSend: 12_345,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.ConnectorError)

    await app.shutdown()
  })

  it('handles invalid F08 errors', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const streamServerPlugin = new MirrorPlugin()
    streamServerPlugin.mirror = receiverPlugin1

    const app = createApp({
      ilpAddress: 'test.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        alice: {
          relation: 'child',
          plugin: senderPlugin2,
          assetCode: 'USD',
          assetScale: 2,
          maxPacketAmount: '10', // $0.10
        },
        bob: {
          relation: 'child',
          plugin: receiverPlugin1,
          assetCode: 'USD',
          assetScale: 2,
        },
      },
    })
    await app.listen()

    // On the first & second packets, reply with an invalid F08: amount received <= maximum.
    // This checks against a potential divide-by-0 error
    let sentFirstInvalidReply = false
    let sentSecondInvalidReply = false
    receiverPlugin2.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)
      if (+prepare.amount >= 1) {
        if (!sentFirstInvalidReply) {
          sentFirstInvalidReply = true

          const writer = new Writer(16)
          writer.writeUInt64(0) // Amount received
          writer.writeUInt64(1) // Maximum

          return serializeIlpReject({
            code: IlpError.F08_AMOUNT_TOO_LARGE,
            message: '',
            triggeredBy: '',
            data: writer.getBuffer(),
          })
        } else if (!sentSecondInvalidReply) {
          sentSecondInvalidReply = true

          const writer = new Writer(16)
          writer.writeUInt64(1) // Amount received
          writer.writeUInt64(1) // Maximum

          return serializeIlpReject({
            code: IlpError.F08_AMOUNT_TOO_LARGE,
            message: '',
            triggeredBy: '',
            data: writer.getBuffer(),
          })
        }
      }

      // Otherwise, the STREAM server should handle the packet
      return streamServerPlugin.dataHandler(data)
    })

    const streamServer = await createServer({
      plugin: streamServerPlugin,
    })

    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Infinity)

        stream.on('money', (amount: string) => {
          // Test that it ignores the invalid F08, and uses
          // the max packet amount of 10
          expect(amount).toBe('10')
        })
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const { startQuote: quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: senderPlugin1,
    })
    const { pay } = await quote({
      amountToSend: 100,
      sourceAsset: {
        code: 'USD',
        scale: 2,
      },
      slippage: 1,
      prices: {},
    })
    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent.value).toBe(BigInt(100))
    expect(receipt.amountDelivered.value).toBe(BigInt(100))

    await app.shutdown()
    await streamServer.close()
  })

  it('retries on temporary errors', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 0,
          plugin: senderPlugin2,
          // Limit to 2 packets / 200ms
          // should ensure a T05 error is encountered
          rateLimit: {
            capacity: 2,
            refillCount: 2,
            refillPeriod: 200,
          },
          maxPacketAmount: '1',
        },
        receiver: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 0,
          plugin: receiverPlugin1,
        },
      },
    })
    await app.listen()

    const streamServer = await createServer({
      plugin: receiverPlugin2,
    })

    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Infinity)
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    // 20 units / 1 max packet amount => at least 20 packets
    const amountToSend = 20
    const { startQuote: quote } = await setupPayment({
      plugin: senderPlugin1,
      sharedSecret,
      destinationAddress,
    })
    const { pay } = await quote({
      amountToSend,
      sourceAsset: {
        code: 'ABC',
        scale: 0,
      },
      slippage: 1,
      prices: {},
    })

    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(+receipt.amountSent).toBe(amountToSend)

    await app.shutdown()
    await streamServer.close()
  }, 20_000)

  it('fails if no packets are fulfilled before idle timeout', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 0,
          plugin: senderPlugin2,
        },
        receiver: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 0,
          plugin: receiverPlugin1,
        },
      },
    })
    await app.listen()

    const streamServer = await createServer({
      plugin: receiverPlugin2,
      // Reject all packets with an F99 reject -- block for 1s so the sender does't spam packets
      shouldFulfill: () => new Promise((_, reject) => setTimeout(reject, 1000)),
    })

    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Infinity)
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const { startQuote: quote } = await setupPayment({
      plugin: senderPlugin1,
      sharedSecret,
      destinationAddress,
    })
    const { pay } = await quote({
      amountToSend: 10,
      sourceAsset: {
        code: 'ABC',
        scale: 0,
      },
    })

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.IdleTimeout)
    expect(receipt.amountSent.value).toBe(BigInt(0))

    await app.shutdown()
    await streamServer.close()
  }, 15_000)

  it('ends payment if the sequence number exceeds encryption safety', async () => {
    const log = createLogger('sequence')
    const controller = new SequenceController()

    controller.applyRequest({
      destinationAddress: 'example.test' as IlpAddress,
      expiresAt: new Date(),
      sequence: 2 ** 32 - 1, // Just below the max sequence number
      sourceAmount: Int.ZERO,
      minDestinationAmount: Int.ZERO,
      frames: [],
      isFulfillable: false,
      log,
    })

    const request = new RequestBuilder()
    const { error } = controller.buildRequest(request) as {
      type: SendStateType.Error
      error: PaymentError
    }
    expect(error).toBe(PaymentError.ExceededMaxSequence)
  })

  it('ends payment if receiver closes the stream', async () => {
    const [alice1, alice2] = MirrorPlugin.createPair()
    const [bob1, bob2] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'test.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        alice: {
          relation: 'child',
          plugin: alice2,
          assetCode: 'USD',
          assetScale: 2,
          maxPacketAmount: '10', // $0.10
        },
        bob: {
          relation: 'child',
          plugin: bob1,
          assetCode: 'USD',
          assetScale: 2,
        },
      },
    })
    await app.listen()

    const streamServer = await createServer({
      plugin: bob2,
    })

    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Long.MAX_UNSIGNED_VALUE)

        stream.on('money', () => {
          // End the stream after 20 units are received
          if (+stream.totalReceived >= 20) {
            stream.end()
          }
        })
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    // Since we're sending $100,000, test will fail due to timeout
    // if the connection isn't closed quickly

    const { startQuote: quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })
    const { pay } = await quote({
      amountToSend: 1000000000,
      sourceAsset: {
        code: 'USD',
        scale: 2,
      },
      slippage: 1,
      prices: {},
    })
    const receipt = await pay()

    expect(receipt.error).toBe(PaymentError.ClosedByReceiver)
    expect(receipt.amountSent.value).toBe(BigInt(20)) // Only $0.20 was sent & received
    expect(receipt.amountDelivered.value).toBe(BigInt(20))

    await app.shutdown()
    await streamServer.close()
  })

  it('ends payment if receiver closes the connection', async () => {
    const [alice1, alice2] = MirrorPlugin.createPair()
    const [bob1, bob2] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'test.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        alice: {
          relation: 'child',
          plugin: alice2,
          assetCode: 'ABC',
          assetScale: 0,
          maxPacketAmount: '1',
        },
        bob: {
          relation: 'child',
          plugin: bob1,
          assetCode: 'ABC',
          assetScale: 0,
        },
      },
    })
    await app.listen()

    const streamServer = await createServer({
      plugin: bob2,
    })

    const connectionPromise = streamServer.acceptConnection()
    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Long.MAX_UNSIGNED_VALUE)
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    // Since we're sending such a large payment, test will fail due to timeout
    // if the payment doesn't end promptly

    const { startQuote: quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })
    const { pay } = await quote({
      amountToSend: 100000000000,
      sourceAsset: {
        code: 'ABC',
        scale: 0,
      },
      slippage: 1,
      prices: {},
    })

    // End the connection after 1 second
    const serverConnection = await connectionPromise
    setTimeout(() => serverConnection.end(), 500)

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.ClosedByReceiver)
    expect(receipt.amountSent.value).toBeGreaterThan(BigInt(1))
    expect(receipt.amountSent.value).toBeLessThan(BigInt(100))
    expect(receipt.amountSent.value).toBe(receipt.amountDelivered.value) // 1:1 rate

    await app.shutdown()
    await streamServer.close()
  }, 10_000)
})

describe('stream receipts', () => {
  it('reports receipts from ilp-protocol-stream server', async () => {
    const [alice1, alice2] = MirrorPlugin.createPair()
    const [bob1, bob2] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'test.larry',
      backend: 'one-to-one',
      spread: 0.05, // 5%
      accounts: {
        alice: {
          relation: 'child',
          plugin: alice2,
          assetCode: 'ABC',
          assetScale: 0,
          maxPacketAmount: '1000',
        },
        bob: {
          relation: 'child',
          plugin: bob1,
          assetCode: 'ABC',
          assetScale: 0,
        },
      },
    })
    await app.listen()

    const streamServer = await createServer({
      plugin: bob2,
    })

    const connectionPromise = streamServer.acceptConnection()
    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Long.MAX_UNSIGNED_VALUE)
      })
    })

    const receiptNonce = randomBytes(16)
    const receiptSecret = randomBytes(32)
    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret({
      receiptNonce,
      receiptSecret,
    })

    const amountToSend = BigInt(10_000) // 10,000 units, 1,000 max packet => ~10 packets
    const { startQuote: quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })
    const { pay } = await quote({
      amountToSend,
      sourceAsset: {
        code: 'ABC',
        scale: 0,
      },
      slippage: 0.1, // 10%
    })

    const receipt = await pay()

    const serverConnection = await connectionPromise
    const totalReceived = BigInt(serverConnection.totalReceived)

    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent.value).toBe(amountToSend)
    expect(receipt.amountDelivered.value).toBe(totalReceived)
    expect(receipt.streamReceipt).toEqual(
      createReceipt({
        nonce: receiptNonce,
        secret: receiptSecret,
        streamId: PaymentController.DEFAULT_STREAM_ID,
        totalReceived: receipt.amountDelivered.toLong()!,
      })
    )

    await app.shutdown()
    await streamServer.close()
  })

  it('reports receipts received out of order', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair(0, 0)

    const server = new StreamServer({
      serverSecret: randomBytes(32),
      serverAddress: 'private.larry',
    })

    const receiptNonce = randomBytes(16)
    const receiptSecret = randomBytes(32)
    const { sharedSecret, ilpAddress: destinationAddress } = server.generateCredentials({
      receiptSetup: {
        nonce: receiptNonce,
        secret: receiptSecret,
      },
    })

    let signedFirstReceipt = false
    receiverPlugin.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)

      // 10 unit max packet size -> 2 packets to complete payment
      if (+prepare.amount > 10) {
        return serializeIlpReject({
          code: IlpError.F08_AMOUNT_TOO_LARGE,
          message: '',
          triggeredBy: '',
          data: Buffer.alloc(0),
        })
      }

      const moneyOrReply = server.createReply(prepare)
      if (isIlpReply(moneyOrReply)) {
        return serializeIlpReply(moneyOrReply)
      }

      // Ensure the first receipt gets processed before signing the second one
      if (signedFirstReceipt) {
        await sleep(500)
      }

      // First, sign a STREAM receipt for 10 units, then a receipt for 5 units
      moneyOrReply.setTotalReceived(!signedFirstReceipt ? 10 : 5)
      signedFirstReceipt = true
      return serializeIlpReply(moneyOrReply.accept())
    })

    const { startQuote: quote } = await setupPayment({
      plugin: senderPlugin,
      sharedSecret,
      destinationAddress,
      destinationAsset: {
        code: 'ABC',
        scale: 4,
      },
    })
    const { pay } = await quote({
      amountToDeliver: 20,
      sourceAsset: {
        code: 'ABC',
        scale: 4,
      },
      slippage: 0.5,
    })

    const { amountDelivered, streamReceipt } = await pay()
    expect(amountDelivered.value).toBe(BigInt(20))
    expect(streamReceipt).toEqual(
      createReceipt({
        nonce: receiptNonce,
        secret: receiptSecret,
        streamId: PaymentController.DEFAULT_STREAM_ID,
        totalReceived: 10, // Greatest of receipts for 10 and 5
      })
    )
  })

  it('discards invalid receipts', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    const sharedSecret = randomBytes(32)
    const encryptionKey = await generatePskEncryptionKey(sharedSecret)
    const fulfillmentKey = await generateFulfillmentKey(sharedSecret)

    // Create simple STREAM receiver that acks test packets,
    // but replies with conflicting asset details
    receiverPlugin.registerDataHandler(async (requestData) => {
      const prepare = deserializeIlpPrepare(requestData)

      const fulfillment = await generateFulfillment(fulfillmentKey, prepare.data)
      const isFulfillable = prepare.executionCondition.equals(await hash(fulfillment))

      const streamRequest = await Packet.decryptAndDeserialize(encryptionKey, prepare.data)

      // Ack incoming packet. Include invalid receipt frame in reply
      const streamReply = new Packet(
        streamRequest.sequence,
        isFulfillable ? IlpPacketType.Fulfill : IlpPacketType.Reject,
        prepare.amount,
        [new StreamReceiptFrame(Long.UONE, randomBytes(64))]
      )
      const data = await streamReply.serializeAndEncrypt(encryptionKey)

      if (isFulfillable) {
        return serializeIlpFulfill({
          fulfillment,
          data,
        })
      } else {
        return serializeIlpReject({
          code: IlpError.F99_APPLICATION_ERROR,
          message: '',
          triggeredBy: '',
          data,
        })
      }
    })

    const { startQuote: quote } = await setupPayment({
      plugin: senderPlugin,
      sharedSecret,
      destinationAddress: 'g.anyone',
      destinationAsset: {
        code: 'ABC',
        scale: 4,
      },
    })
    const { pay } = await quote({
      amountToDeliver: 20,
      sourceAsset: {
        code: 'ABC',
        scale: 4,
      },
      slippage: 0,
    })

    const { amountDelivered, streamReceipt } = await pay()
    expect(amountDelivered.isPositive())
    expect(streamReceipt).toBeUndefined()
  })
})
