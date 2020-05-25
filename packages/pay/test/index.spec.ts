/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { createApp } from 'ilp-connector'
import RateBackend from 'ilp-connector/dist/services/rate-backend'
import BigNumber from 'bignumber.js'
import { Connection, createServer, DataAndMoneyStream } from 'ilp-protocol-stream'
import Long from 'long'
import reduct from 'reduct'
import { CustomBackend } from './rate-backend'
import { MirrorPlugin } from './plugin'
import { fetchCoinCapRates } from '../src/rates/coincap'
import { getRate } from '../src/rates'
import { quote, PaymentError } from '../src'
import { describe, it, expect, jest } from '@jest/globals'
import express from 'express'
import https from 'https'
import { createCertificate, CertificateCreationResult } from 'pem'
import { Errors, serializeIlpFulfill, deserializeIlpPrepare, serializeIlpReject } from 'ilp-packet'
import { sleep } from '../src/utils'
import {
  randomBytes,
  generateFulfillment,
  generateFulfillmentKey,
  generatePskEncryptionKey,
  hash,
} from 'ilp-protocol-stream/dist/src/crypto'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { serve } from 'ilp-protocol-ildcp'
import { Packet, IlpPacketType } from 'ilp-protocol-stream/dist/src/packet'
import { GenericContainer, Wait } from 'testcontainers'
import Axios from 'axios'
import PluginHttp from 'ilp-plugin-http'
import getPort from 'get-port'
import { Duration, TemporalUnit } from 'node-duration'

// TODO Remove non-determinism from CoinCap rates
// TODO Add timeout to fetching CoinCap rates

describe('setup/quoting flow', () => {
  it('fails if given no payment pointer or STREAM credentials', async () => {
    await expect(
      quote({
        plugin: new MirrorPlugin(),
      })
    ).rejects.toBe(PaymentError.InvalidCredentials)
  })

  it('fails given a semantically invalid payment pointer', async () => {
    await expect(
      quote({
        plugin: new MirrorPlugin(),
        paymentPointer: 'ht$tps://example.com',
      })
    ).rejects.toBe(PaymentError.InvalidPaymentPointer)
  })

  it('fails if payment pointer cannot resolve', async () => {
    await expect(
      quote({
        plugin: new MirrorPlugin(),
        paymentPointer: 'https://example.com/foo/bar',
      })
    ).rejects.toBe(PaymentError.SpspQueryFailed)
  })

  it('fails if SPSP response is invalid', async () => {
    const spspApp = express().get('/foo', (_, res) => res.json())
    const spspServer = spspApp.listen(8080)

    await expect(
      quote({
        plugin: new MirrorPlugin(),
        paymentPointer: 'http://localhost:8080/foo',
      })
    ).rejects.toBe(PaymentError.SpspQueryFailed)

    spspServer.close()
  })

  it('resolves SPSP query from payment pointer', async () => {
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
    })

    const connectionHandler = jest.fn()
    streamServer.on('connection', connectionHandler)

    // Generate self-signed certificate for local server
    const keys = await new Promise<CertificateCreationResult>((resolve, reject) =>
      createCertificate({ days: 1, selfSigned: true }, (err, keys) =>
        err ? reject(err) : resolve(keys)
      )
    )

    // Allows self-signed certificates in HTTP requests
    https.globalAgent.options.rejectUnauthorized = false

    // Start server hosting payment pointer
    const spspApp = express()
    spspApp.get('/.well-known/pay', (req, res) => {
      if (req.headers?.accept?.includes('application/spsp4+json')) {
        const credentials = streamServer.generateAddressAndSecret()

        res
          .json({
            destination_account: credentials.destinationAccount,
            shared_secret: credentials.sharedSecret.toString('base64'),
          })
          .type('application/spsp4+json')
          .send()
      } else {
        res.sendStatus(400)
      }
    })
    const spspServer = https
      .createServer({ key: keys.serviceKey, cert: keys.certificate }, spspApp)
      .listen(4300) // 443 requires root, so use a different port

    const details = await quote({
      paymentPointer: '$localhost:4300',
      plugin: senderPlugin1,
      amountToSend: new BigNumber(1000),
    })

    // Connection should be able to be established after resolving payment pointer
    expect(connectionHandler.mock.calls.length).toBe(1)

    await details.cancel()
    expect(!senderPlugin1.isConnected())

    await app.shutdown()
    await streamServer.close()
    spspServer.close()
  })

  it('fails if the slippage is invalid', async () => {
    await expect(
      quote({
        plugin: new MirrorPlugin(),
        sharedSecret: Buffer.alloc(32),
        destinationAddress: 'g.recipient',
        slippage: NaN,
      })
    ).rejects.toBe(PaymentError.InvalidSlippage)

    await expect(
      quote({
        plugin: new MirrorPlugin(),
        sharedSecret: Buffer.alloc(32),
        destinationAddress: 'g.recipient',
        slippage: Infinity,
      })
    ).rejects.toBe(PaymentError.InvalidSlippage)

    await expect(
      quote({
        plugin: new MirrorPlugin(),
        sharedSecret: Buffer.alloc(32),
        destinationAddress: 'g.recipient',
        slippage: 1.2,
      })
    ).rejects.toBe(PaymentError.InvalidSlippage)

    await expect(
      quote({
        plugin: new MirrorPlugin(),
        sharedSecret: Buffer.alloc(32),
        destinationAddress: 'g.recipient',
        slippage: -0.0001,
      })
    ).rejects.toBe(PaymentError.InvalidSlippage)
  })

  it('fails if plugin cannot connect', async () => {
    const plugin: Plugin = {
      async connect() {
        throw new Error('Failed to connect')
      },
      async disconnect() {},
      isConnected() {
        return false
      },
      async sendData() {
        return Buffer.alloc(0)
      },
      registerDataHandler() {},
      deregisterDataHandler() {},
    }

    await expect(
      quote({
        plugin,
        destinationAddress: 'g.me',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.Disconnected)
  })

  it('fails if plugin cannot handle IL-DCP requests', async () => {
    const plugin = new MirrorPlugin()

    await expect(
      quote({
        plugin,
        destinationAddress: 'private.foo',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.UnknownSourceAsset)
    expect(!plugin.isConnected())
  })

  it('fails if source account details are invalid', async () => {
    const plugin: Plugin = {
      async connect() {},
      async disconnect() {},
      isConnected() {
        return true
      },
      sendData(data) {
        // Handle IL-DCP requests
        // Return invalid ILP address
        return serve({
          requestPacket: data,
          handler: async () => ({
            clientAddress: 'private',
            assetCode: 'USD',
            assetScale: 2,
          }),
          serverAddress: 'private',
        })
      },
      registerDataHandler() {},
      deregisterDataHandler() {},
    }

    await expect(
      quote({
        plugin,
        sharedSecret: Buffer.alloc(32),
        destinationAddress: 'private.someone',
      })
    ).rejects.toBe(PaymentError.UnknownSourceAsset)
  })

  it('fails on incompatible address schemes', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'g.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        default: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 0,
          plugin: receiverPlugin,
        },
      },
    })
    await app.listen()

    await expect(
      quote({
        plugin: senderPlugin,
        amountToSend: 10,
        destinationAddress: 'test.unknown',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.IncompatibleIntegerledgerNetworks)
    expect(!senderPlugin.isConnected())

    await app.shutdown()
  })

  it('fails if amount to send is 0, negative, NaN, or Infinity', async () => {
    const [senderPlugin, connectorPlugin] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 4,
          plugin: connectorPlugin,
        },
      },
    })
    await app.listen()

    // Fails with negative source amount
    await expect(
      quote({
        plugin: senderPlugin,
        amountToSend: -3.14,
        destinationAddress: 'private.foo',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.InvalidSourceAmount)
    expect(!senderPlugin.isConnected())

    // Fails with 0 source amount
    await expect(
      quote({
        plugin: senderPlugin,
        amountToSend: 0,
        destinationAddress: 'private.foo',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.InvalidSourceAmount)
    expect(!senderPlugin.isConnected())

    // Fails with `NaN` source amount
    await expect(
      quote({
        plugin: senderPlugin,
        amountToSend: NaN,
        destinationAddress: 'private.foo',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.InvalidSourceAmount)
    expect(!senderPlugin.isConnected())

    // Fails with `Infinity` source amount
    await expect(
      quote({
        plugin: senderPlugin,
        amountToSend: Infinity,
        destinationAddress: 'private.foo',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.InvalidSourceAmount)
    expect(!senderPlugin.isConnected())

    await app.shutdown()
  })

  it('fails if amount to send is more precise than source account', async () => {
    const [senderPlugin, connectorPlugin] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 3, // Asset scale only allows 3 units of precision
          plugin: connectorPlugin,
        },
      },
    })
    await app.listen()

    await expect(
      quote({
        plugin: senderPlugin,
        amountToSend: 100.0001,
        destinationAddress: 'private.receiver',
        sharedSecret: randomBytes(32),
      })
    ).rejects.toBe(PaymentError.InvalidSourceAmount)
    expect(!senderPlugin.isConnected())

    await app.shutdown()
  })

  it('fails if no asset details were provided for fixed delivery', async () => {
    const [senderPlugin, connectorPlugin] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 0,
          plugin: connectorPlugin,
        },
      },
    })
    await app.listen()

    await expect(
      quote({
        plugin: senderPlugin,
        amountToDeliver: 8000,
        destinationAddress: 'private.foo',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.UnknownDestinationAsset)
    expect(!senderPlugin.isConnected())

    await app.shutdown()
  })

  it('fails if amount to deliver is 0, negative, NaN, or Infinity', async () => {
    const [senderPlugin, connectorPlugin] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 4,
          plugin: connectorPlugin,
        },
      },
    })
    await app.listen()

    // Fails with negative delivery amount
    await expect(
      quote({
        plugin: senderPlugin,
        amountToDeliver: -7778.1,
        destinationAssetCode: 'XYZ',
        destinationAssetScale: 2,
        destinationAddress: 'private.foo',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.InvalidDestinationAmount)
    expect(!senderPlugin.isConnected())

    // Fails with 0 delivery amount
    await expect(
      quote({
        plugin: senderPlugin,
        amountToDeliver: 0,
        destinationAssetCode: 'XYZ',
        destinationAssetScale: 2,
        destinationAddress: 'private.foo',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.InvalidDestinationAmount)
    expect(!senderPlugin.isConnected())

    // Fails with `NaN` delivery amount
    await expect(
      quote({
        plugin: senderPlugin,
        amountToDeliver: NaN,
        destinationAssetCode: 'XYZ',
        destinationAssetScale: 2,
        destinationAddress: 'private.foo',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.InvalidDestinationAmount)
    expect(!senderPlugin.isConnected())

    // Fails with `Infinity` delivery amount
    await expect(
      quote({
        plugin: senderPlugin,
        amountToDeliver: Infinity,
        destinationAssetCode: 'XYZ',
        destinationAssetScale: 2,
        destinationAddress: 'private.foo',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.InvalidDestinationAmount)
    expect(!senderPlugin.isConnected())

    await app.shutdown()
  })

  it('fails if amount to deliver is more precise than destination account', async () => {
    const [senderPlugin, connectorPlugin] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 3,
          plugin: connectorPlugin,
        },
      },
    })
    await app.listen()

    await expect(
      quote({
        plugin: senderPlugin,
        amountToDeliver: 567.89, // Too precise for scale 1
        destinationAssetCode: 'XYZ',
        destinationAssetScale: 1,
        destinationAddress: 'private.receiver',
        sharedSecret: randomBytes(32),
      })
    ).rejects.toBe(PaymentError.InvalidDestinationAmount)
    expect(!senderPlugin.isConnected())

    await app.shutdown()
  })

  it('fails if no amount to send or deliver was provided', async () => {
    const [senderPlugin, connectorPlugin] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 3,
          plugin: connectorPlugin,
        },
      },
    })
    await app.listen()

    await expect(
      quote({
        plugin: senderPlugin,
        destinationAddress: 'private.receiver',
        sharedSecret: randomBytes(32),
      })
    ).rejects.toBe(PaymentError.UnknownPaymentTarget)
    expect(!senderPlugin.isConnected())

    await app.shutdown()
  })

  it('fails on asset detail conflicts', async () => {
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

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    await expect(
      quote({
        plugin: senderPlugin1,
        amountToDeliver: 100,
        destinationAssetCode: 'XYZ',
        destinationAssetScale: 2,
        destinationAddress,
        sharedSecret,
      })
    ).rejects.toBe(PaymentError.DestinationAssetConflict)

    expect(!senderPlugin1.isConnected())

    await app.shutdown()
    await streamServer.close()
  })

  it('fails if recipient never shared destination asset details', async () => {
    const [senderPlugin, connectorPlugin] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 3,
          plugin: connectorPlugin,
        },
      },
    })
    await app.listen()

    // If the recipient never tells us their destination asset,
    // we can't enforce exchange rates, so it should fail.

    // To test this, the STREAM sender sends packets to itself,
    // which are all ACKed with F99 rejects. Since the "recipient"
    // never replies with its asset details, the quote should fail

    await expect(
      quote({
        plugin: senderPlugin,
        amountToSend: 100,
        destinationAddress: 'private.larry.sender',
        sharedSecret: randomBytes(32),
      })
    ).rejects.toBe(PaymentError.UnknownDestinationAsset)
    expect(!senderPlugin.isConnected())

    await app.shutdown()
  })

  it('fails if external price for the source asset is unavailable', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'some really weird currency',
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
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    await expect(
      quote({
        plugin: senderPlugin1,
        amountToSend: 100,
        destinationAddress,
        sharedSecret,
      })
    ).rejects.toBe(PaymentError.ExternalRateUnavailable)
    expect(!senderPlugin1.isConnected())

    await app.shutdown()
    await streamServer.close()
  })

  it('fails if external price for the destination asset is unavailable', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 3,
          plugin: senderPlugin2,
        },
        receiver: {
          relation: 'child',
          assetCode: 'THIS_ASSET_CODE_DOES_NOT_EXIST',
          assetScale: 3,
          plugin: receiverPlugin1,
        },
      },
    })
    await app.listen()

    const streamServer = await createServer({
      plugin: receiverPlugin2,
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    await expect(
      quote({
        plugin: senderPlugin1,
        amountToSend: 303.222,
        destinationAddress,
        sharedSecret,
      })
    ).rejects.toBe(PaymentError.ExternalRateUnavailable)
    expect(!senderPlugin1.isConnected())

    await app.shutdown()
    await streamServer.close()
  })

  it('fails if external rate is 0', async () => {
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
          assetCode: 'XYZ',
          assetScale: 0,
          plugin: receiverPlugin1,
        },
      },
    })
    await app.listen()

    const streamServer = await createServer({
      plugin: receiverPlugin2,
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    await expect(
      quote({
        plugin: senderPlugin1,
        amountToSend: '1000',
        destinationAddress,
        sharedSecret,
        prices: {
          ABC: 1,
          XYZ: 0,
        },
      })
    ).rejects.toBe(PaymentError.ExternalRateUnavailable)
    expect(!senderPlugin1.isConnected())

    await app.shutdown()
    await streamServer.close()
  })

  it('discovers precise max packet amount from F08s without metadata', async () => {
    const [senderPlugin1, maxPacketPlugin] = MirrorPlugin.createPair()
    const connectorPlugin = new MirrorPlugin()
    connectorPlugin.mirror = senderPlugin1

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
          plugin: connectorPlugin,
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

    const maxPacketAmount = 300324
    let largestAmountReceived = 0

    // Add middleware to return F08 errors *without* metadata
    // and track the greatest packet amount that's sent
    maxPacketPlugin.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)
      if (+prepare.amount > maxPacketAmount) {
        return serializeIlpReject({
          code: Errors.codes.F08_AMOUNT_TOO_LARGE,
          message: '',
          triggeredBy: '',
          data: Buffer.alloc(0),
        })
      } else {
        largestAmountReceived = Math.max(largestAmountReceived, +prepare.amount)
        return connectorPlugin.dataHandler(data)
      }
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const { cancel } = await quote({
      plugin: senderPlugin1,
      amountToSend: 40_000_000,
      sharedSecret,
      destinationAddress,
    })

    await cancel()

    // If STREAM did discover the max packet amount,
    // since the rate is 1:1, the largest packet the receiver got
    // should be exactly the max packet amount
    expect(largestAmountReceived).toBe(maxPacketAmount)

    await app.shutdown()
    await streamServer.close()
  }, 10000)
})

describe('fixed source payments', () => {
  it('completes source amount payment with max packet amount', async () => {
    const [alice1, alice2] = MirrorPlugin.createPair()
    const [bob1, bob2] = MirrorPlugin.createPair()

    // Override with rate backend for custom rates
    const deps = reduct()
    deps.setOverride(RateBackend, CustomBackend)

    const prices = await fetchCoinCapRates()

    const app = createApp(
      {
        ilpAddress: 'test.larry',
        spread: 0.014, // 1.4% slippage
        backendConfig: {
          prices,
        },
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

    const amountToSend = new BigNumber(1.00427)
    const { pay, ...quoteDetails } = await quote({
      amountToSend,
      destinationAddress,
      sharedSecret,
      plugin: alice1,
      slippage: 0.015,
    })

    expect(quoteDetails.sourceAccount.assetCode).toBe('USD')
    expect(quoteDetails.sourceAccount.assetScale).toBe(6)
    expect(quoteDetails.sourceAccount.ilpAddress).toBe('test.larry.alice')
    expect(quoteDetails.destinationAccount.assetCode).toBe('XRP')
    expect(quoteDetails.destinationAccount.assetScale).toBe(9)
    expect(quoteDetails.destinationAccount.ilpAddress).toBe(destinationAddress)
    expect(quoteDetails.maxSourceAmount).toEqual(amountToSend)

    const receipt = await pay()

    const serverConnection = await connectionPromise
    expect(new BigNumber(serverConnection.totalReceived)).toEqual(
      receipt.amountDelivered.shiftedBy(9)
    )
    expect(receipt.amountSent).toEqual(amountToSend)
    expect(receipt.amountInFlight).toEqual(new BigNumber(0))

    await app.shutdown()
    await streamServer.close()
  }, 10000)

  it('complete source amount payment with no latency', async () => {
    const [alice1, alice2] = MirrorPlugin.createPair(0, 0)
    const [bob1, bob2] = MirrorPlugin.createPair(0, 0)

    // Override with rate backend for custom rates
    const deps = reduct()
    deps.setOverride(RateBackend, CustomBackend)

    const prices = await fetchCoinCapRates()

    const app = createApp(
      {
        ilpAddress: 'test.larry',
        spread: 0,
        backendConfig: {
          prices,
        },
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
      },
      deps
    )
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
    const { pay } = await quote({
      amountToSend: 100,
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })

    const receipt = await pay()

    expect(highestNumberPacketsInFlight).toBe(20)
    expect(+receipt.amountSent).toEqual(100)
    expect(+receipt.amountInFlight).toEqual(0)
    expect(receipt.error).toBeUndefined()

    await app.shutdown()
    await streamServer.close()
  }, 10000)

  it('completes source amount payment with no rate enforcement', async () => {
    const [alice1, alice2] = MirrorPlugin.createPair()
    const [bob1, bob2] = MirrorPlugin.createPair()

    // Override with rate backend for custom rates
    const deps = reduct()
    deps.setOverride(RateBackend, CustomBackend)

    const prices = {
      ABC: 3.2,
      XYZ: 1.5,
    }

    const app = createApp(
      {
        ilpAddress: 'test.larry',
        spread: 0.014, // 1.4% slippage
        backendConfig: {
          prices,
        },
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

    const amountToSend = new BigNumber(10_000)
    const { pay, minExchangeRate } = await quote({
      amountToSend,
      destinationAddress,
      sharedSecret,
      plugin: alice1,
      slippage: 1, // Disables rate enforcement
      prices,
    })
    expect(minExchangeRate).toEqual(new BigNumber(0))

    const receipt = await pay()
    expect(receipt.amountSent).toEqual(amountToSend)
    expect(receipt.amountInFlight).toEqual(new BigNumber(0))
    expect(receipt.amountDelivered.isGreaterThan(0))

    await app.shutdown()
    await streamServer.close()
  })

  it.todo('fails if receive max is incompatible')
})

describe('fixed delivery payments', () => {
  it('delivers fixed destination amount with max packet amount', async () => {
    const [alice1, alice2] = MirrorPlugin.createPair()
    const [bob1, bob2] = MirrorPlugin.createPair()

    // Override with rate backend for custom rates
    const deps = reduct()
    deps.setOverride(RateBackend, CustomBackend)

    const prices = await fetchCoinCapRates()

    const app = createApp(
      {
        ilpAddress: 'test.larry',
        spread: 0.01, // 1% spread
        backendConfig: {
          prices,
        },
        accounts: {
          alice: {
            relation: 'child',
            plugin: alice2,
            assetCode: 'ETH',
            assetScale: 9,
            maxPacketAmount: '899898',
          },
          bob: {
            relation: 'child',
            plugin: bob1,
            assetCode: 'BTC',
            assetScale: 8,
          },
        },
      },
      deps
    )
    await app.listen()

    const streamServer = await createServer({
      plugin: bob2,
    })

    const amountToDeliver = getRate('USD', 0, 'BTC', 0, prices)?.times(10).decimalPlaces(8)
    if (!amountToDeliver) {
      return Promise.reject()
    }

    const connectionPromise = streamServer.acceptConnection()
    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(amountToDeliver.shiftedBy(8).toString())
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const { pay, ...quoteDetails } = await quote({
      amountToDeliver,
      destinationAssetCode: 'BTC',
      destinationAssetScale: 8,
      destinationAddress,
      sharedSecret,
      slippage: 0.015,
      plugin: alice1,
    })

    const receipt = await pay()

    const serverConnection = await connectionPromise
    const totalReceived = new BigNumber(serverConnection.totalReceived)
    expect(totalReceived).toEqual(amountToDeliver.shiftedBy(8))
    expect(receipt.amountDelivered).toEqual(amountToDeliver)
    expect(receipt.amountInFlight).toEqual(new BigNumber(0))
    expect(receipt.amountSent.isLessThanOrEqualTo(quoteDetails.maxSourceAmount))

    await app.shutdown()
    await streamServer.close()
  }, 10000)

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

    const [alicePlugin1, alicePlugin2] = MirrorPlugin.createPair(20, 30)
    const [peerPlugin1, peerPlugin2] = MirrorPlugin.createPair(20, 30)
    const [bobPlugin1, bobPlugin2] = MirrorPlugin.createPair(20, 30)

    // Override with rate backend for custom rates
    const deps = reduct()
    deps.setOverride(RateBackend, CustomBackend)

    const aliceConnector = createApp(
      {
        ilpAddress: 'test.alice',
        defaultRoute: 'bob',
        spread: 0.005, // 0.5%
        backendConfig: {
          prices,
        },
        accounts: {
          sender: {
            relation: 'child',
            plugin: alicePlugin2,
            assetCode: 'BTC',
            assetScale: 8,
            // Tests multiple max packet amounts will get reduced
            maxPacketAmount: '2000000', // 0.02 BTC (larger than $0.01)
          },
          bob: {
            relation: 'peer',
            plugin: peerPlugin1,
            assetCode: 'USD',
            assetScale: 6,
          },
        },
      },
      deps
    )

    // Override with rate backend for custom rates
    const deps2 = reduct()
    deps2.setOverride(RateBackend, CustomBackend)

    const bobConnector = createApp(
      {
        ilpAddress: 'test.bob',
        spread: 0.0031, // 0.31%
        backendConfig: {
          prices,
        },
        accounts: {
          alice: {
            relation: 'peer',
            plugin: peerPlugin2,
            assetCode: 'USD',
            assetScale: 6,
            // Tests correct max packet amount computation in remote asset
            maxPacketAmount: '10000' /* $0.01 */,
          },
          receiver: {
            relation: 'child',
            plugin: bobPlugin1,
            assetCode: 'XRP',
            assetScale: 9,
          },
        },
      },
      deps2
    )

    await Promise.all([aliceConnector.listen(), bobConnector.listen()])

    const streamServer = await createServer({
      plugin: bobPlugin2,
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

    // (1 - 0.031) * (1 - 0.005) => 0.9919155

    // Connector spread: 0.80845%
    // Sender accepts up to: 0.85%

    const amountToDeliver = new BigNumber(10) // 10 XRP, ~$2 at given prices
    const { pay, ...quoteDetails } = await quote({
      plugin: alicePlugin1,
      amountToDeliver,
      destinationAssetCode: 'XRP',
      destinationAssetScale: 9,
      destinationAddress,
      sharedSecret,
      slippage: 0.0085,
      prices,
    })

    const receipt = await pay()

    const serverConnection = await connectionPromise
    const totalReceived = new BigNumber(serverConnection.totalReceived).shiftedBy(-9)
    expect(receipt.amountDelivered).toEqual(totalReceived)

    // Ensure at least the invoice amount was delivered
    expect(receipt.amountDelivered.isGreaterThanOrEqualTo(amountToDeliver))

    // Ensure over-delivery is minimized to the equivalent of a single unit in the source asset
    const maxOverDeliveryAmount = getRate('BTC', 8, 'XRP', 9, prices)!
    expect(receipt.amountDelivered.isLessThanOrEqualTo(amountToDeliver.plus(maxOverDeliveryAmount)))

    expect(receipt.amountInFlight).toEqual(new BigNumber(0))
    expect(receipt.amountSent.isLessThanOrEqualTo(quoteDetails.maxSourceAmount))

    await aliceConnector.shutdown()
    await bobConnector.shutdown()

    await streamServer.close()
  }, 10000)

  // TODO This should error during the quoting flow
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

    const { pay } = await quote({
      plugin: senderPlugin1,
      amountToDeliver: 100,
      destinationAssetCode: 'ABC',
      destinationAssetScale: 4,
      destinationAddress,
      sharedSecret,
    })

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.IncompatibleReceiveMax)

    await app.shutdown()
    await streamServer.close()
  })

  it('accounts for fulfilled packets even if data is corrupted', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0.01,
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
    receiverPlugin2.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)

      const fulfillment = await generateFulfillment(fulfillmentKey, prepare.data)
      const isFulfillable = prepare.executionCondition.equals(await hash(fulfillment))

      if (isFulfillable) {
        // On fulfillable packets, fulfill *without valid STREAM data*
        return serializeIlpFulfill({
          fulfillment,
          data: randomBytes(200),
        })
      } else {
        // On test packets, reject and ACK as normal so the quote succeeds
        const streamPacket = await Packet.decryptAndDeserialize(encryptionKey, prepare.data)
        const reject = new Packet(streamPacket.sequence, IlpPacketType.Reject, prepare.amount)
        return serializeIlpReject({
          code: Errors.codes.F99_APPLICATION_ERROR,
          message: '',
          triggeredBy: '',
          data: await reject.serializeAndEncrypt(encryptionKey),
        })
      }
    })

    const { pay, ...quoteDetails } = await quote({
      plugin: senderPlugin1,
      amountToDeliver: 100,
      destinationAssetCode: 'ABC',
      destinationAssetScale: 0,
      destinationAddress,
      sharedSecret,
      slippage: 0.06,
    })

    const receipt = await pay()
    expect(+receipt.amountDelivered).toEqual(100)
    expect(+receipt.amountSent).toBeLessThanOrEqual(+quoteDetails.maxSourceAmount)
    expect(+receipt.amountInFlight).toEqual(0)

    await app.shutdown()
  }, 10000)

  it('accounts for delivered amounts if the recipient claims to receive less than minimum', async () => {
    // Since the received packets claim 1 unit, the payment will fail due to exchange rate issues
    // So, the 5 Prepares need to be sent in quick succession, so increase the latency
    // TODO The better approach here is the receiver misbheaving should fail immediately with a protocol violation
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair(100, 100)
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair(100, 100)

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
    receiverPlugin2.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)

      const streamPacket = await Packet.decryptAndDeserialize(encryptionKey, prepare.data)

      const fulfillment = await generateFulfillment(fulfillmentKey, prepare.data)
      const isFulfillable = prepare.executionCondition.equals(await hash(fulfillment))

      if (isFulfillable) {
        // On fulfillable packets, fulfill, but lie and say we only received 1 unit
        const streamReply = new Packet(streamPacket.sequence, IlpPacketType.Fulfill, 1)
        return serializeIlpFulfill({
          fulfillment,
          data: await streamReply.serializeAndEncrypt(encryptionKey),
        })
      } else {
        // On test packets, reject and ACK as normal so the quote succeeds
        const reject = new Packet(streamPacket.sequence, IlpPacketType.Reject, prepare.amount)
        return serializeIlpReject({
          code: Errors.codes.F99_APPLICATION_ERROR,
          message: '',
          triggeredBy: '',
          data: await reject.serializeAndEncrypt(encryptionKey),
        })
      }
    })

    const { pay, ...quoteDetails } = await quote({
      plugin: senderPlugin1,
      amountToDeliver: 100,
      destinationAssetCode: 'ABC',
      destinationAssetScale: 0,
      destinationAddress,
      sharedSecret,
      slippage: 0,
    })

    const receipt = await pay()
    expect(+receipt.amountDelivered).toEqual(100)
    expect(+receipt.amountSent).toBeLessThanOrEqual(+quoteDetails.maxSourceAmount)
    expect(+receipt.amountInFlight).toEqual(0)

    await app.shutdown()
  })
})

describe('payment execution', () => {
  it('fails on final Reject errors', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        default: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 0,
          plugin: receiverPlugin,
        },
      },
    })
    await app.listen()

    await expect(
      quote({
        plugin: senderPlugin,
        amountToSend: 10,
        destinationAddress: 'private.unknown', // Un-routable address
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.TerminalReject)

    await app.shutdown()
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
          // Limit to 1 packet / 100ms
          // should ensure a T05 error is encountered
          rateLimit: {
            capacity: 1,
            refillCount: 1,
            refillPeriod: 100,
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

    // 10 units / 1 max packet amount => at least 10 packets
    const amountToSend = 10
    const { pay } = await quote({
      plugin: senderPlugin1,
      amountToSend,
      sharedSecret,
      destinationAddress,
    })

    const receipt = await pay()
    expect(+receipt.amountSent).toBe(amountToSend)

    await app.shutdown()
    await streamServer.close()
  })

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

    const { pay } = await quote({
      plugin: senderPlugin1,
      amountToSend: 10,
      destinationAddress,
      sharedSecret,
    })

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.IdleTimeout)
    expect(receipt.amountSent).toEqual(new BigNumber(0))

    await app.shutdown()
    await streamServer.close()
  }, 15000)

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

    const { pay } = await quote({
      amountToSend: new BigNumber(10000000),
      destinationAddress,
      sharedSecret,
      slippage: 0,
      plugin: alice1,
    })
    const receipt = await pay()

    expect(receipt.error).toBe(PaymentError.ClosedByRecipient)
    expect(receipt.amountSent).toEqual(new BigNumber(0.2)) // Only $0.20 was received
    expect(receipt.amountDelivered).toEqual(new BigNumber(0.2)) // Only $0.20 was received
    expect(receipt.amountInFlight).toEqual(new BigNumber(0))

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

    const { pay } = await quote({
      amountToSend: new BigNumber(100000000000),
      destinationAddress,
      sharedSecret,
      slippage: 0,
      plugin: alice1,
    })

    // End the connection after 1 second
    const serverConnection = await connectionPromise
    setTimeout(() => serverConnection.end(), 500)

    const receipt = await pay()

    expect(receipt.error).toBe(PaymentError.ClosedByRecipient)
    expect(receipt.amountSent.isGreaterThan(1))
    expect(receipt.amountSent.isLessThan(100))
    expect(receipt.amountSent).toEqual(receipt.amountDelivered)
    expect(receipt.amountInFlight).toEqual(new BigNumber(0))

    await app.shutdown()
    await streamServer.close()
  }, 10000)
})

describe('interledger.rs integration', () => {
  it('pays to SPSP server', async () => {
    // TODO Switch all of this over to custom Docker network after this PR is merged:
    // https://github.com/testcontainers/testcontainers-node/pull/76
    // (Note: don't use the default bridge network since it doesn't resolve
    //  hostnames and requires knowing the container IP addresses, but `testcontainers`
    //  won't give me access to that... even `getContainerIpAddress()` just returns
    //  localhost!)

    // Setup Redis
    const redisContainer = await new GenericContainer('redis').withExposedPorts(6379).start()
    const redisPort = redisContainer.getMappedPort(6379)

    // Setup the Rust connector
    const adminAuthToken = 'admin'
    const rustNodeContainer = await new GenericContainer('interledgerrs/ilp-node')
      .withEnv('ILP_SECRET_SEED', randomBytes(32).toString('hex'))
      .withEnv('ILP_ADMIN_AUTH_TOKEN', adminAuthToken)
      .withEnv('ILP_DATABASE_URL', `redis://localhost:${redisPort}`)
      .withEnv('ILP_ILP_ADDRESS', 'g.corp')
      .withNetworkMode('host')
      .start()

    // The Docker image doesn't currently support logging, so wait for it to startup
    await sleep(5000)

    // Create receiver account
    await Axios.post(
      `http://localhost:7770/accounts`,
      {
        username: 'receiver',
        asset_code: 'EUR',
        asset_scale: 6,
        // Required to interact with the account over its HTTP API
        ilp_over_http_outgoing_token: 'password',
        ilp_over_http_incoming_token: 'password',
      },
      {
        headers: {
          Authorization: `Bearer ${adminAuthToken}`,
        },
      }
    )

    const senderPort = await getPort()
    const plugin = new PluginHttp({
      incoming: {
        port: senderPort,
        staticToken: 'password',
      },
      outgoing: {
        url: `http://localhost:7770/accounts/sender/ilp`,
        staticToken: 'password',
      },
    })

    // Create account for sender to connect to
    await Axios.post(
      `http://localhost:7770/accounts`,
      {
        username: 'sender',
        asset_code: 'EUR',
        asset_scale: 6,
        routing_relation: 'child',
        ilp_over_http_url: `http://localhost:${senderPort}`,
        ilp_over_http_outgoing_token: 'password',
        ilp_over_http_incoming_token: 'password',
        max_packet_amount: '2000',
      },
      {
        headers: {
          Authorization: `Bearer ${adminAuthToken}`,
        },
      }
    )

    const amountToSend = 0.1 // ~50 packets @ max packet amount of 2000
    const { pay } = await quote({
      plugin,
      paymentPointer: `http://localhost:7770/accounts/receiver/spsp`,
      amountToSend,
    })

    const receipt = await pay()
    expect(+receipt.amountSent).toBe(amountToSend)
    expect(+receipt.amountInFlight).toBe(0)
    expect(+receipt.amountDelivered).toBe(amountToSend) // Exchange rate is 1:1

    // Check the balance
    const { data } = await Axios({
      method: 'GET',
      url: `http://localhost:7770/accounts/receiver/balance`,
      headers: {
        Authorization: 'Bearer password',
      },
    })
    // Interledger.rs balances are also in normal units
    expect(data.balance).toBe(amountToSend)

    await plugin.disconnect()

    await redisContainer.stop()
    await rustNodeContainer.stop()
  }, 30000)
})

describe('interledger4j integration', () => {
  it('pays to SPSP server', async () => {
    // Setup Redis
    const redisContainer = await new GenericContainer('redis').withExposedPorts(6379).start()
    const redisPort = redisContainer.getMappedPort(6379)

    // Setup the Java connector
    const adminPassword = 'admin'
    const connectorContainer = await new GenericContainer(
      'interledger4j/java-ilpv4-connector',
      'nightly'
    )
      .withEnv('redis.host', `redis://localhost:${redisPort}`)
      .withEnv('interledger.connector.adminPassword', adminPassword)
      .withEnv('interledger.connector.enabledFeatures.localSpspFulfillmentEnabled', 'true')
      .withEnv('interledger.connector.enabledProtocols.spspEnabled', 'true')
      .withNetworkMode('host')
      .withWaitStrategy(Wait.forLogMessage('STARTED INTERLEDGER CONNECTOR'))
      .start()

    // Create receiver account
    await Axios.post(
      `http://localhost:8080/accounts`,
      {
        accountId: 'receiver',
        accountRelationship: 'PEER',
        linkType: 'ILP_OVER_HTTP',
        assetCode: 'USD',
        assetScale: '2',
        sendRoutes: true,
        receiveRoutes: true,
        customSettings: {
          'ilpOverHttp.incoming.auth_type': 'SIMPLE',
          'ilpOverHttp.incoming.simple.auth_token': 'password',
        },
      },
      {
        auth: {
          username: 'admin',
          password: adminPassword,
        },
      }
    )

    const senderPort = await getPort()
    const plugin = new PluginHttp({
      incoming: {
        port: senderPort,
        staticToken: 'password',
      },
      outgoing: {
        url: `http://localhost:8080/accounts/sender/ilp`,
        staticToken: 'password',
      },
    })

    // Create account for sender to connect to
    await Axios.post(
      `http://localhost:8080/accounts`,
      {
        accountId: 'sender',
        accountRelationship: 'CHILD',
        linkType: 'ILP_OVER_HTTP',
        assetCode: 'USD',
        assetScale: '2',
        maximumPacketAmount: '1',
        sendRoutes: true,
        receiveRoutes: true,
        customSettings: {
          'ilpOverHttp.incoming.auth_type': 'SIMPLE',
          'ilpOverHttp.incoming.simple.auth_token': 'password',
        },
      },
      {
        auth: {
          username: 'admin',
          password: adminPassword,
        },
      }
    )

    const amountToSend = 0.1 // $0.10 @ max packet amount of $0.01 => 10 packets
    const { pay } = await quote({
      plugin,
      paymentPointer: `http://localhost:8080/receiver`,
      amountToSend,
    })

    const receipt = await pay()
    expect(+receipt.amountSent).toBe(amountToSend)
    expect(+receipt.amountInFlight).toBe(0)
    expect(+receipt.amountDelivered).toBe(amountToSend) // Exchange rate is 1:1

    // // Check the balance
    const { data } = await Axios({
      method: 'GET',
      url: `http://localhost:8080/accounts/receiver/balance`,
      auth: {
        username: 'admin',
        password: adminPassword,
      },
    })
    expect(data.accountBalance.netBalance).toBe('10')
    expect(data.accountBalance.clearingBalance).toBe('10')

    await plugin.disconnect()

    await connectorContainer.stop()
    await redisContainer.stop()
  }, 30000)
})
