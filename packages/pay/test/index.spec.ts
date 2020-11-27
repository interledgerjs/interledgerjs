/* eslint-disable prefer-const, @typescript-eslint/no-empty-function, @typescript-eslint/no-non-null-assertion */
import { StreamServer } from '@interledger/stream-receiver'
import { describe, expect, it, jest } from '@jest/globals'
import Axios from 'axios'
import getPort from 'get-port'
import { createApp } from 'ilp-connector'
import createLogger from 'ilp-logger'
import {
  deserializeIlpPrepare,
  IlpAddress,
  IlpError,
  isIlpReply,
  serializeIlpFulfill,
  serializeIlpReject,
  serializeIlpReply,
  IlpReply,
} from 'ilp-packet'
import PluginHttp from 'ilp-plugin-http'
import { Connection, createServer, DataAndMoneyStream, createReceipt } from 'ilp-protocol-stream'
import {
  generateFulfillment,
  generateFulfillmentKey,
  generatePskEncryptionKey,
  hash,
  randomBytes,
} from 'ilp-protocol-stream/dist/src/crypto'
import {
  ConnectionAssetDetailsFrame,
  IlpPacketType,
  Packet,
  StreamReceiptFrame,
} from 'ilp-protocol-stream/dist/src/packet'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import Long from 'long'
import nock from 'nock'
import { Writer } from 'oer-utils'
import reduct from 'reduct'
import { GenericContainer, Network, Wait } from 'testcontainers'
import { v4 as uuid } from 'uuid'
import { PaymentError, setupPayment } from '../src'
import { SequenceController } from '../src/controllers/sequence'
import { fetchPaymentDetails } from '../src/open-payments'
import { Int, PositiveInt, Ratio, sleep } from '../src/utils'
import { MirrorPlugin } from './helpers/plugin'
import { CustomBackend } from './helpers/rate-backend'
import { StreamFulfill, DEFAULT_REQUEST } from '../src/request'
import { PaymentController } from '../src/controllers/payment'
import { ReceiptController } from '../src/controllers/receipt'

describe('open payments', () => {
  const destinationAddress = 'g.wallet.receiver.12345'
  const sharedSecret = randomBytes(32)
  const sharedSecretBase64 = sharedSecret.toString('base64')

  // TODO Move this test somewhere else/to fixed delivery section? It's more integration
  it('resolves an invoice', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const prices = {
      EUR: 1,
      USD: 1.12,
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
            assetCode: 'EUR',
            assetScale: 3,
            plugin: senderPlugin2,
          },
          receiver: {
            relation: 'child',
            assetCode: 'USD',
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

    const connectionHandler = jest.fn()
    streamServer.on('connection', connectionHandler)

    const invoiceId = uuid()
    const { destinationAccount, sharedSecret } = streamServer.generateAddressAndSecret({
      connectionTag: invoiceId,
    })

    const accountUrl = 'https://wallet.example/alice'
    const invoiceUrl = `${accountUrl}/invoices/${invoiceId}`
    const expiresAt = Date.now() + 60 * 60 * 1000 * 24 // 1 day in the future
    const description = 'Coffee'

    nock('https://wallet.example')
      .get(`/alice/invoices/${invoiceId}`)
      .matchHeader('Accept', 'application/ilp-stream+json')
      .reply(200, {
        id: invoiceUrl,
        account: accountUrl,
        amount: '45601',
        received: '0',
        assetCode: 'USD',
        assetScale: 4,
        expiresAt: new Date(expiresAt).toISOString(),
        description,
        ilpAddress: destinationAccount,
        sharedSecret: sharedSecret.toString('base64'),
      })

    const { quote, invoice, destinationAsset, destinationAddress } = await setupPayment({
      invoiceUrl,
      plugin: senderPlugin1,
    })
    const { minDeliveryAmount, close } = await quote({
      prices,
      sourceAsset: {
        assetCode: 'EUR',
        assetScale: 4,
      },
    })
    expect(minDeliveryAmount.value).toBe(45601n)
    expect(invoice).toMatchObject({
      invoiceUrl,
      accountUrl,
      expiresAt,
      description,
      amountDelivered: Int.ZERO,
      amountToDeliver: Int.from(45601),
    })
    expect(destinationAsset).toMatchObject({
      assetCode: 'USD',
      assetScale: 4,
    })
    expect(destinationAddress).toBe(destinationAccount)
    expect(connectionHandler).toBeCalledTimes(1)

    await close()
    expect(!senderPlugin1.isConnected())

    await app.shutdown()
    await streamServer.close()
  })

  it('fails if the invoice was already paid', async () => {
    const [senderPlugin, connectorPlugin] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'g.larry',
      backend: 'one-to-one',
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'EUR',
          assetScale: 3,
          plugin: connectorPlugin,
        },
      },
    })
    await app.listen()

    const invoiceId = uuid()
    const sharedSecret = randomBytes(32)
    const destinationAddress = 'g.larry.server3'

    const accountUrl = 'https://wallet.example/alice'
    const invoiceUrl = `${accountUrl}/invoices/${invoiceId}`

    nock('https://wallet.example')
      .get(`/alice/invoices/${invoiceId}`)
      .matchHeader('Accept', 'application/ilp-stream+json')
      .reply(200, {
        id: invoiceUrl,
        account: accountUrl,
        amount: '200',
        received: '203', // Paid $2.03 of $2 invoice
        assetCode: 'USD',
        assetScale: 2,
        expiresAt: new Date().toISOString(),
        description: 'Something really amazing',
        ilpAddress: destinationAddress,
        sharedSecret: sharedSecret.toString('base64'),
      })

    const { quote } = await setupPayment({
      invoiceUrl,
      plugin: senderPlugin,
    })
    await expect(
      quote({
        sourceAsset: {
          assetCode: 'EUR',
          assetScale: 3,
        },
      })
    ).rejects.toBe(PaymentError.InvoiceAlreadyPaid)

    await app.shutdown()
  })

  it('validates provided STREAM credentials', async () => {
    const sharedSecret = randomBytes(32)
    const destinationAddress = 'test.foo.~hello~world'
    await expect(fetchPaymentDetails({ sharedSecret, destinationAddress })).resolves.toMatchObject({
      sharedSecret,
      destinationAddress,
    })
  })

  it('fails if provided invalid STREAM credentials', async () => {
    await expect(
      fetchPaymentDetails({ sharedSecret: randomBytes(31), destinationAddress: 'private' })
    ).resolves.toBe(PaymentError.InvalidCredentials)
  })

  it('fails if no mechanism to fetch STREAM credentials was provided', async () => {
    await expect(fetchPaymentDetails({ plugin: new MirrorPlugin() })).resolves.toBe(
      PaymentError.InvalidCredentials
    )
  })

  it('resolves and validates an invoice', async () => {
    const destinationAddress = 'g.wallet.users.alice.~w6247823482374234'
    const sharedSecret = randomBytes(32)
    const invoiceId = uuid()

    const accountUrl = 'https://wallet.example/alice'
    const invoiceUrl = `${accountUrl}/invoices/${invoiceId}`
    const expiresAt = Date.now() + 60 * 60 * 1000 * 24 // 1 day in the future
    const description = 'Coffee'

    const scope = nock('https://wallet.example')
      .get(`/alice/invoices/${invoiceId}`)
      .matchHeader('Accept', 'application/ilp-stream+json')
      .reply(200, {
        id: invoiceUrl,
        account: accountUrl,
        amount: '45601',
        received: '0',
        assetCode: 'USD',
        assetScale: 4,
        expiresAt: new Date(expiresAt).toISOString(),
        description,
        ilpAddress: destinationAddress,
        sharedSecret: sharedSecret.toString('base64'),
      })

    await expect(fetchPaymentDetails({ invoiceUrl })).resolves.toMatchObject({
      sharedSecret,
      destinationAddress,
      destinationAsset: {
        assetCode: 'USD',
        assetScale: 4,
      },
      invoice: {
        amountDelivered: Int.ZERO,
        amountToDeliver: Int.from(45601),
        invoiceUrl,
        accountUrl,
        expiresAt,
        description,
      },
    })
    scope.done()
  })

  it('validates invoice amounts are positive and u64', async () => {
    const invoiceId = uuid()
    const accountUrl = 'https://wallet.example/alice'
    const invoiceUrl = `${accountUrl}/invoices/${invoiceId}`

    nock('https://wallet.example')
      .get(`/alice/invoices/${invoiceId}`)
      .matchHeader('Accept', 'application/ilp-stream+json')
      .reply(200, {
        id: invoiceUrl,
        account: accountUrl,
        amount: '100000000000000000000000000000000000000000000000000000000',
        received: -20,
        assetCode: 'USD',
        assetScale: 5,
        expiresAt: new Date().toISOString(),
        description: 'Something special',
        ilpAddress: 'private.foo',
        sharedSecret: Buffer.alloc(32),
      })

    await expect(fetchPaymentDetails({ invoiceUrl })).resolves.toBe(PaymentError.QueryFailed)
  })

  it('fails if an invoice query times out', async () => {
    const scope = nock('https://money.example').get(/.*/).delay(6000).reply(500)
    await expect(fetchPaymentDetails({ invoiceUrl: 'https://money.example' })).resolves.toBe(
      PaymentError.QueryFailed
    )
    scope.done()
    nock.abortPendingRequests()
  })

  it('fails if an invoice query response is invalid', async () => {
    const scope1 = nock('https://example.com/foo').get(/.*/).reply(200, 'not an invoice')
    await expect(fetchPaymentDetails({ invoiceUrl: 'https://example.com/foo' })).resolves.toBe(
      PaymentError.QueryFailed
    )
    scope1.done()

    const invoiceUrl = 'http://open.mywallet.com/invoices/123'

    const scope2 = nock('http://open.mywallet.com').get(`/invoices/123`).reply(404) // Query fails
    await expect(fetchPaymentDetails({ invoiceUrl })).resolves.toBe(PaymentError.QueryFailed)
    scope2.done()

    const scope3 = nock('http://open.mywallet.com')
      .get(`/invoices/123`)
      .reply(200, {
        // Invalid invoice: no details included
        sharedSecret: randomBytes(32).toString('base64'),
        ilpAddress: 'private.larry.receiver',
      })
    await expect(fetchPaymentDetails({ invoiceUrl })).resolves.toBe(PaymentError.QueryFailed)
    scope3.done()
  })

  it('fails if given a payment pointer as an invoice url', async () => {
    await expect(fetchPaymentDetails({ invoiceUrl: '$foo.money' })).resolves.toBe(
      PaymentError.QueryFailed
    )
  })

  it('fails account query if the payment pointer is invalid', async () => {
    await expect(fetchPaymentDetails({ paymentPointer: 'ht$tps://example.com' })).resolves.toBe(
      PaymentError.InvalidPaymentPointer
    )
  })

  it('resolves credentials from an Open Payments account', async () => {
    const scope = nock('https://open.mywallet.com')
      .get('/accounts/alice')
      .matchHeader('Accept', /application\/ilp-stream\+json*./)
      .reply(200, {
        id: 'https://open.mywallet.com/accounts/alice',
        accountServicer: 'https://open.mywallet.com/',
        sharedSecret: sharedSecretBase64,
        ilpAddress: destinationAddress,
        assetCode: 'USD',
        assetScale: 6,
      })

    const credentials = await fetchPaymentDetails({
      paymentPointer: '$open.mywallet.com/accounts/alice',
    })
    expect(credentials).toMatchObject({
      sharedSecret,
      destinationAddress,
      destinationAsset: {
        assetCode: 'USD',
        assetScale: 6,
      },
    })
    scope.done()
  })

  it('resolves credentials from SPSP', async () => {
    const scope = nock('https://alice.mywallet.com')
      .get('/.well-known/pay')
      .matchHeader('Accept', /application\/spsp4\+json*./)
      .delay(1000)
      .reply(200, {
        destination_account: destinationAddress,
        shared_secret: sharedSecretBase64,
        receiptsEnabled: false,
      })

    const credentials = await fetchPaymentDetails({ paymentPointer: '$alice.mywallet.com' })
    expect(credentials).toMatchObject({
      sharedSecret,
      destinationAddress,
    })
    scope.done()
  })

  it('fails if account query fails', async () => {
    const scope = nock('https://open.mywallet.com').get(/.*/).reply(500)
    await expect(fetchPaymentDetails({ paymentPointer: '$open.mywallet.com' })).resolves.toBe(
      PaymentError.QueryFailed
    )
    scope.done()
  })

  it('fails if account query times out', async () => {
    const scope = nock('https://open.mywallet.com').get(/.*/).delay(7000).reply(500)
    await expect(fetchPaymentDetails({ paymentPointer: '$open.mywallet.com' })).resolves.toBe(
      PaymentError.QueryFailed
    )
    scope.done()
    nock.abortPendingRequests()
  })

  it('fails if account query returns an invalid response', async () => {
    const scope1 = nock('https://example.com/foo').get(/.*/).reply(200, 'this is a string')
    await expect(fetchPaymentDetails({ paymentPointer: '$example.com/foo' })).resolves.toBe(
      PaymentError.QueryFailed
    )
    scope1.done()

    // Invalid shared secret in SPSP response
    const scope2 = nock('https://alice.mywallet.com').get('/.well-known/pay').reply(200, {
      destination_account: 'g.foo',
      shared_secret: 'Zm9v',
    })

    await expect(fetchPaymentDetails({ paymentPointer: '$alice.mywallet.com' })).resolves.toBe(
      PaymentError.QueryFailed
    )
    scope2.done()
  })

  it('follows spsp redirect', async () => {
    const scope1 = nock('https://wallet1.example/').get('/.well-known/pay').reply(
      307, // Temporary redirect
      {},
      {
        Location: 'https://wallet2.example/.well-known/pay',
      }
    )

    const scope2 = nock('https://wallet2.example/')
      .get('/.well-known/pay')
      .matchHeader('Accept', /application\/spsp4\+json*./)
      .reply(200, { destination_account: destinationAddress, shared_secret: sharedSecretBase64 })

    const credentials = await fetchPaymentDetails({ paymentPointer: 'https://wallet1.example' })
    expect(credentials).toMatchObject({
      sharedSecret,
      destinationAddress,
    })
    scope1.done()
    scope2.done()
  })
})

// TODO Where to have these?
it.todo('quotes remaining amount to deliver in the invoice')
it.todo('fails if the invoice expires before the payment can complete')

describe('setup flow', () => {
  it('fails if given no payment pointer or STREAM credentials', async () => {
    await expect(
      setupPayment({
        plugin: new MirrorPlugin(),
      })
    ).rejects.toBe(PaymentError.InvalidCredentials)
  })

  it('fails given a semantically invalid payment pointer', async () => {
    await expect(
      setupPayment({
        plugin: new MirrorPlugin(),
        paymentPointer: 'ht$tps://example.com',
      })
    ).rejects.toBe(PaymentError.InvalidPaymentPointer)
  })

  it('fails if payment pointer cannot resolve', async () => {
    await expect(
      setupPayment({
        plugin: new MirrorPlugin(),
        paymentPointer: 'https://example.com/foo/bar',
      })
    ).rejects.toBe(PaymentError.QueryFailed)
  })

  it('fails if SPSP response is invalid', async () => {
    const scope = nock('http://example.com').get('/foo').reply(200, { meh: 'why?' })

    await expect(
      setupPayment({
        plugin: new MirrorPlugin(),
        paymentPointer: `http://example.com/foo`,
      })
    ).rejects.toBe(PaymentError.QueryFailed)
    scope.done()
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

    const scope = nock('https://example.com')
      .get('/.well-known/pay')
      .matchHeader('Accept', /application\/spsp4\+json*./)
      .reply(() => {
        const credentials = streamServer.generateAddressAndSecret()

        return [
          200,
          {
            destination_account: credentials.destinationAccount,
            shared_secret: credentials.sharedSecret.toString('base64'),
          },
          { 'Content-Type': 'application/spsp4+json' },
        ]
      })

    const details = await setupPayment({
      paymentPointer: 'https://example.com',
      plugin: senderPlugin1,
    })

    // Connection should be able to be established after resolving payment pointer
    expect(connectionHandler.mock.calls.length).toBe(1)
    scope.done()

    await details.close()
    expect(!senderPlugin1.isConnected())

    await app.shutdown()
    await streamServer.close()
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
      setupPayment({
        plugin,
        destinationAddress: 'g.me',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.Disconnected)
  })

  it('fails on asset detail conflicts', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    const sharedSecret = randomBytes(32)
    const encryptionKey = await generatePskEncryptionKey(sharedSecret)

    // Create simple STREAM receiver that acks test packets,
    // but replies with conflicting asset details
    receiverPlugin.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)

      const streamRequest = await Packet.decryptAndDeserialize(encryptionKey, prepare.data)

      const streamReply = new Packet(streamRequest.sequence, IlpPacketType.Reject, prepare.amount, [
        new ConnectionAssetDetailsFrame('ABC', 2),
        new ConnectionAssetDetailsFrame('XYZ', 2),
        new ConnectionAssetDetailsFrame('XYZ', 3),
      ])

      return serializeIlpReject({
        code: IlpError.F99_APPLICATION_ERROR,
        message: '',
        triggeredBy: '',
        data: await streamReply.serializeAndEncrypt(encryptionKey),
      })
    })

    await expect(
      setupPayment({
        plugin: senderPlugin,
        destinationAddress: 'private.larry.receiver',
        sharedSecret,
      })
    ).rejects.toBe(PaymentError.DestinationAssetConflict)
    expect(!senderPlugin.isConnected())
  })
})

describe('quoting flow', () => {
  it('fails if amount to send is not a positive integer', async () => {
    const plugin = new MirrorPlugin()
    const asset = {
      assetCode: 'ABC',
      assetScale: 4,
    }
    const { quote } = await setupPayment({
      plugin,
      destinationAsset: asset,
      destinationAddress: 'private.foo',
      sharedSecret: Buffer.alloc(32),
    })

    // Fails with negative source amount
    await expect(
      quote({
        amountToSend: -2n,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidSourceAmount)
    expect(!plugin.isConnected())

    // Fails with fractional source amount
    await expect(
      quote({
        amountToSend: '3.14',
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidSourceAmount)

    // Fails with 0 source amount
    await expect(
      quote({
        amountToSend: 0,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidSourceAmount)

    // Fails with `NaN` source amount
    await expect(
      quote({
        amountToSend: NaN,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidSourceAmount)

    // Fails with `Infinity` source amount
    await expect(
      quote({
        amountToSend: Infinity,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidSourceAmount)

    // Fails with Int if source amount is 0
    await expect(
      quote({
        amountToSend: Int.ZERO,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidSourceAmount)
  })

  it('fails if amount to deliver is not a positive integer', async () => {
    const plugin = new MirrorPlugin()
    const asset = {
      assetCode: 'ABC',
      assetScale: 4,
    }
    const { quote } = await setupPayment({
      plugin,
      destinationAsset: asset,
      destinationAddress: 'private.foo',
      sharedSecret: Buffer.alloc(32),
    })

    // Fails with negative source amount
    await expect(
      quote({
        amountToDeliver: -2n,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidDestinationAmount)
    expect(!plugin.isConnected())

    // Fails with fractional source amount
    await expect(
      quote({
        amountToDeliver: '3.14',
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidDestinationAmount)

    // Fails with 0 source amount
    await expect(
      quote({
        amountToDeliver: 0,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidDestinationAmount)

    // Fails with `NaN` source amount
    await expect(
      quote({
        amountToDeliver: NaN,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidDestinationAmount)

    // Fails with `Infinity` source amount
    await expect(
      quote({
        amountToDeliver: Infinity,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidDestinationAmount)

    // Fails with Int if source amount is 0
    await expect(
      quote({
        amountToDeliver: Int.ZERO,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidDestinationAmount)
  })

  it('fails if no invoice, nor amount to send/deliver was provided', async () => {
    const plugin = new MirrorPlugin()
    const asset = {
      assetCode: 'ABC',
      assetScale: 3,
    }

    const { quote } = await setupPayment({
      plugin,
      destinationAddress: 'private.receiver',
      destinationAsset: asset,
      sharedSecret: randomBytes(32),
    })
    await expect(
      quote({
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.UnknownPaymentTarget)
    expect(!plugin.isConnected())
  })

  // TODO Also ensure there's a test of the asset probe,
  //      if no packets are delivered
  //      Should the error be different if no packets were delivered?
  it('fails if no test packets are delivered', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    receiverPlugin.registerDataHandler(async () =>
      serializeIlpReject({
        code: IlpError.T01_PEER_UNREACHABLE,
        message: '',
        triggeredBy: '',
        data: Buffer.alloc(0),
      })
    )

    const asset = {
      assetCode: 'USD',
      assetScale: 6,
    }

    const { quote } = await setupPayment({
      plugin: senderPlugin,
      destinationAddress: 'private.larry.receiver',
      destinationAsset: asset,
      sharedSecret: Buffer.alloc(32),
    })
    await expect(
      quote({
        amountToSend: '1000',
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.RateProbeFailed)
    expect(!senderPlugin.isConnected())
  }, 15000)

  it('fails if max packet amount is 0', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    const streamServer = new StreamServer({
      serverSecret: randomBytes(32),
      serverAddress: 'private.receiver',
    })

    const { sharedSecret, ilpAddress: destinationAddress } = streamServer.generateCredentials()

    // `ilp-connector` doesn't support 0 max packet amount,
    // so use a custom middleware to test this
    receiverPlugin.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)
      if (+prepare.amount > 0) {
        const writer = new Writer(16)
        writer.writeUInt64(prepare.amount) // Amount received
        writer.writeUInt64(0) // Maximum

        return serializeIlpReject({
          code: IlpError.F08_AMOUNT_TOO_LARGE,
          message: '',
          triggeredBy: '',
          data: writer.getBuffer(),
        })
      } else {
        // TODO Is this necessary if it never gets past here?
        const moneyOrReply = streamServer.createReply(prepare)
        if (isIlpReply(moneyOrReply)) {
          return serializeIlpReply(moneyOrReply)
        }

        return serializeIlpReply(moneyOrReply.accept())
      }
    })

    const { quote } = await setupPayment({
      plugin: senderPlugin,
      destinationAddress,
      destinationAsset: {
        assetCode: 'ABC',
        assetScale: 0,
      },
      sharedSecret,
    })
    await expect(
      quote({
        amountToSend: 1000,
        sourceAsset: {
          assetCode: 'ABC',
          assetScale: 0,
        },
      })
    ).rejects.toBe(PaymentError.ConnectorError)
    expect(!senderPlugin.isConnected())
  })

  // TODO SHould have different test if authenticated replies are received,
  //      but no asset details, vs no auth reply is received
  it('fails if recipient never shared destination asset details', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    const server = new StreamServer({
      serverAddress: 'private.larry.receiver',
      serverSecret: randomBytes(32),
    })

    // Accept incoming money
    receiverPlugin.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)
      const moneyOrReply = server.createReply(prepare)
      if (isIlpReply(moneyOrReply)) {
        return serializeIlpReply(moneyOrReply)
      }

      return serializeIlpReply(moneyOrReply.accept())
    })

    // Server will not reply with asset details
    // since none were provided
    const credentials = server.generateCredentials()

    await expect(
      setupPayment({
        plugin: senderPlugin,
        destinationAddress: credentials.ilpAddress,
        sharedSecret: credentials.sharedSecret,
      })
    ).rejects.toBe(PaymentError.UnknownDestinationAsset)
    expect(!senderPlugin.isConnected())
  })

  it('fails if price api is unavailable', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'JPY',
          assetScale: 0,
          plugin: senderPlugin2,
        },
        receiver: {
          relation: 'child',
          assetCode: 'GBP',
          assetScale: 0,
          plugin: receiverPlugin1,
        },
      },
    })
    await app.listen()

    const streamServer = await createServer({
      plugin: receiverPlugin2,
    })

    const tryQuote = async () => {
      const {
        sharedSecret,
        destinationAccount: destinationAddress,
      } = streamServer.generateAddressAndSecret()

      const { quote } = await setupPayment({
        plugin: senderPlugin1,
        destinationAddress,
        sharedSecret,
      })
      await expect(
        quote({
          amountToSend: 100,
          sourceAsset: {
            assetCode: 'JPY',
            assetScale: 0,
          },
        })
      ).rejects.toBe(PaymentError.ExternalRateUnavailable)
      expect(!senderPlugin1.isConnected())
    }

    const response = {
      timestamp: Date.now(),
      data: [
        {
          symbol: 'JPY',
          rateUsd: 1,
        },
        {
          symbol: 'GBP',
          priceUsd: 1,
        },
      ],
    }

    nock('https://api.coincap.io')
      .get('/v2/assets')
      .delay(7000)
      .reply(200, response)
      .get('/v2/rates')
      .reply(200, response)
    await tryQuote()
    nock.cleanAll()

    nock('https://api.coincap.io')
      .get('/v2/rates')
      .reply(400)
      .get('/v2/assets')
      .reply(200, response)
    await tryQuote()
    nock.cleanAll()

    await app.shutdown()
    await streamServer.close()

    nock.abortPendingRequests()
  })

  it.todo('any invoice tests here?')

  it('fails if slippage is invalid', async () => {
    const asset = {
      assetCode: 'ABC',
      assetScale: 2,
    }

    const plugin = new MirrorPlugin()
    const { quote } = await setupPayment({
      plugin,
      sharedSecret: Buffer.alloc(32),
      destinationAddress: 'g.recipient',
      destinationAsset: asset,
    })

    await expect(
      quote({
        slippage: NaN,
        amountToSend: 10,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidSlippage)
    expect(!plugin.isConnected())

    await expect(
      quote({
        slippage: Infinity,
        amountToSend: 10,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidSlippage)

    await expect(
      quote({
        slippage: 1.2,
        amountToSend: 10,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidSlippage)

    await expect(
      quote({
        slippage: -0.0001,
        amountToSend: 10,
        sourceAsset: asset,
      })
    ).rejects.toBe(PaymentError.InvalidSlippage)
  })

  it('fails if source asset details are invalid', async () => {
    const asset = {
      assetCode: 'ABC',
      assetScale: 2,
    }

    const plugin = new MirrorPlugin()
    const { quote } = await setupPayment({
      plugin,
      sharedSecret: Buffer.alloc(32),
      destinationAddress: 'g.recipient',
      destinationAsset: asset,
    })

    await expect(
      quote({
        amountToSend: 10,
        sourceAsset: {
          assetCode: 'ABC',
          assetScale: NaN,
        },
      })
    ).rejects.toBe(PaymentError.UnknownSourceAsset)
    expect(!plugin.isConnected())

    await expect(
      quote({
        amountToSend: 10,
        sourceAsset: {
          assetCode: 'KRW',
          assetScale: Infinity,
        },
      })
    ).rejects.toBe(PaymentError.UnknownSourceAsset)

    await expect(
      quote({
        amountToSend: 10,
        sourceAsset: {
          assetCode: 'CNY',
          assetScale: -20,
        },
      })
    ).rejects.toBe(PaymentError.UnknownSourceAsset)

    await expect(
      quote({
        amountToSend: 10,
        sourceAsset: {
          assetCode: 'USD',
          assetScale: 256,
        },
      })
    ).rejects.toBe(PaymentError.UnknownSourceAsset)
  })

  it('fails if no external price for the source asset exists', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    const streamServer = new StreamServer({
      serverSecret: randomBytes(32),
      serverAddress: 'private.larry',
    })

    const { sharedSecret, ilpAddress: destinationAddress } = streamServer.generateCredentials({
      asset: {
        code: 'ABC',
        scale: 0,
      },
    })

    receiverPlugin.registerDataHandler(async (data) =>
      serializeIlpReply(streamServer.createReply(deserializeIlpPrepare(data)) as IlpReply)
    )

    const { quote } = await setupPayment({
      plugin: senderPlugin,
      destinationAddress,
      sharedSecret,
    })
    await expect(
      quote({
        amountToSend: 100,
        sourceAsset: {
          assetCode: 'some really weird currency',
          assetScale: 0,
        },
      })
    ).rejects.toBe(PaymentError.ExternalRateUnavailable)
    expect(!senderPlugin.isConnected())
  })

  it('fails if no external price for the destination asset exists', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

    const streamServer = new StreamServer({
      serverSecret: randomBytes(32),
      serverAddress: 'private.larry',
    })

    const { sharedSecret, ilpAddress: destinationAddress } = streamServer.generateCredentials({
      asset: {
        code: 'THIS_ASSET_CODE_DOES_NOT_EXIST',
        scale: 0,
      },
    })

    receiverPlugin.registerDataHandler(async (data) =>
      serializeIlpReply(streamServer.createReply(deserializeIlpPrepare(data)) as IlpReply)
    )

    const { quote } = await setupPayment({
      plugin: senderPlugin,
      destinationAddress,
      sharedSecret,
    })
    await expect(
      quote({
        amountToSend: 100,
        sourceAsset: {
          assetCode: 'USD',
          assetScale: 3,
        },
      })
    ).rejects.toBe(PaymentError.ExternalRateUnavailable)
    expect(!senderPlugin.isConnected())
  })

  it('fails if the external exchange rate is 0', async () => {
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

    const { quote } = await setupPayment({
      plugin: senderPlugin1,
      destinationAddress,
      sharedSecret,
    })
    await expect(
      quote({
        amountToSend: '1000',
        sourceAsset: {
          assetCode: 'ABC',
          assetScale: 0,
        },
        prices: {
          // Computing this rate would be a divide-by-0 error,
          // so the rate is "unavailable" rather than quoted as 0
          ABC: 1,
          XYZ: 0,
        },
      })
    ).rejects.toBe(PaymentError.ExternalRateUnavailable)
    expect(!senderPlugin1.isConnected())

    await app.shutdown()
    await streamServer.close()
  })

  it('fails it the probed rate is below the minimum rate', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const sourceAsset = {
      assetCode: 'ABC',
      assetScale: 4,
    }

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0.02,
      accounts: {
        sender: {
          relation: 'child',
          plugin: senderPlugin2,
          ...sourceAsset,
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

    const { quote } = await setupPayment({
      plugin: senderPlugin1,
      destinationAddress,
      sharedSecret,
    })
    await expect(
      quote({
        amountToSend: '1000',
        sourceAsset,
        slippage: 0.01,
      })
    ).rejects.toBe(PaymentError.InsufficientExchangeRate)
    expect(!senderPlugin1.isConnected())

    await app.shutdown()
    await streamServer.close()
  })

  it('fails if the probed rate is 0', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
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

    const sourceAsset = {
      assetCode: 'BTC',
      assetScale: 8,
    }

    const app = createApp(
      {
        ilpAddress: 'private.larry',
        // All packets here should round down to 0 EUR
        accounts: {
          sender: {
            relation: 'child',
            plugin: senderPlugin2,
            maxPacketAmount: '1000',
            ...sourceAsset,
          },
          receiver: {
            relation: 'child',
            assetCode: 'EUR',
            assetScale: 0,
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

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const { quote } = await setupPayment({
      plugin: senderPlugin1,
      destinationAddress,
      sharedSecret,
    })
    await expect(
      quote({
        amountToSend: '1000',
        sourceAsset,
        prices,
      })
    ).rejects.toBe(PaymentError.InsufficientExchangeRate)
    expect(!senderPlugin1.isConnected())

    await app.shutdown()
    await streamServer.close()
  })

  it('fails if min rate and max packet amount would cause rounding errors', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
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

    const sourceAsset = {
      assetCode: 'BTC',
      assetScale: 8,
    }

    const app = createApp(
      {
        ilpAddress: 'private.larry',
        spread: 0.0005,
        accounts: {
          sender: {
            relation: 'child',
            plugin: senderPlugin2,
            maxPacketAmount: '1000',
            ...sourceAsset,
          },
          receiver: {
            relation: 'child',
            assetCode: 'EUR',
            assetScale: 6,
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

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const { quote } = await setupPayment({
      plugin: senderPlugin1,
      destinationAddress,
      sharedSecret,
    })
    await expect(
      quote({
        amountToSend: 100_000,
        sourceAsset,
        // Slippage/minExchangeRate is far too close to the real spread/rate
        // to perform the payment without rounding errors, since the max packet
        // amount of 1000 doesn't allow more precision.
        slippage: 0.00051,
        prices,
      })
    ).rejects.toBe(PaymentError.ExchangeRateRoundingError)
    expect(!senderPlugin1.isConnected())

    await app.shutdown()
    await streamServer.close()
  })

  it('discovers precise max packet amount from F08s without metadata', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const streamServerPlugin = new MirrorPlugin()
    streamServerPlugin.mirror = receiverPlugin1

    const sourceAsset = {
      assetCode: 'ABC',
      assetScale: 0,
    }

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        sender: {
          relation: 'child',
          plugin: senderPlugin2,
          ...sourceAsset,
          // This tests the max packet state transition from precise -> imprecise
          maxPacketAmount: '1000000',
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
      plugin: streamServerPlugin,
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
    receiverPlugin2.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)
      if (+prepare.amount > maxPacketAmount) {
        return serializeIlpReject({
          code: IlpError.F08_AMOUNT_TOO_LARGE,
          message: '',
          triggeredBy: '',
          data: Buffer.alloc(0),
        })
      } else {
        largestAmountReceived = Math.max(largestAmountReceived, +prepare.amount)
        return streamServerPlugin.dataHandler(data)
      }
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const { quote } = await setupPayment({
      plugin: senderPlugin1,
      sharedSecret,
      destinationAddress,
    })
    const { close } = await quote({
      amountToSend: 40_000_000,
      sourceAsset,
    })

    await close()

    // If STREAM did discover the max packet amount,
    // since the rate is 1:1, the largest packet the receiver got
    // should be exactly the max packet amount
    expect(largestAmountReceived).toBe(maxPacketAmount)

    await app.shutdown()
    await streamServer.close()
  }, 10000)

  it.todo('works if theres no max packet amount without sending max u64 packets')
})

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

    const amountToSend = 100427n
    const resolved = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })
    const { pay, ...quoteDetails } = await resolved.quote({
      amountToSend,
      sourceAsset: {
        assetCode: 'USD',
        assetScale: 6,
      },
      slippage: 0.015,
      prices,
    })

    expect(resolved.destinationAsset).toEqual({
      assetCode: 'XRP',
      assetScale: 9,
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
  }, 10000)

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

    const { quote } = await setupPayment({
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
        assetCode: 'BTC',
        assetScale: 8,
      },
      slippage: 0.002,
      prices,
    })
    expect(details.maxSourceAmount.value).toBe(100002n)

    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent.value).toBe(100002n)
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
    const { quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })
    const { pay } = await quote({
      amountToSend: 100,
      sourceAsset: {
        assetCode: 'XYZ',
        assetScale: 0,
      },
      slippage: 1,
      prices: {},
    })

    const receipt = await pay()

    expect(receipt.error).toBeUndefined()
    expect(highestNumberPacketsInFlight).toBe(20)
    expect(receipt.amountSent.value).toBe(100n)

    await app.shutdown()
    await streamServer.close()
  }, 10000)

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

    const { quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })
    const amountToSend = 10_000n
    const { pay, minExchangeRate } = await quote({
      amountToSend,
      sourceAsset: {
        assetCode: 'ABC',
        assetScale: 0,
      },
      slippage: 1, // Disables rate enforcement
      prices,
    })
    expect(minExchangeRate).toBe(0)

    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent.value).toBe(amountToSend)
    expect(receipt.amountDelivered.value).toBeGreaterThan(0n)

    await app.shutdown()
    await streamServer.close()
  })

  it.todo('fails if receive max is incompatible')
})

describe('fixed delivery payments', () => {
  it('delivers fixed destination amount with max packet amount', async () => {
    const [alice1, alice2] = MirrorPlugin.createPair()
    const [bob1, bob2] = MirrorPlugin.createPair()

    const prices = {
      USD: 1,
      EUR: 1.0805787579827757,
      BTC: 9290.22557286273,
      ETH: 208.46218430418685,
      XRP: 0.2199704769864391,
      JPY: 0.00942729201037,
      GBP: 1.2344993179391268,
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

    const amountToDeliver = Int.from(107643)! // $10 in BTC
    const connectionPromise = streamServer.acceptConnection()
    streamServer.on('connection', (connection: Connection) => {
      connection.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(amountToDeliver.toString())
      })
    })

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    const { quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })
    const { pay, maxSourceAmount } = await quote({
      amountToDeliver,
      sourceAsset: {
        assetCode: 'ETH',
        assetScale: 9,
      },
      slippage: 0.015,
      prices,
    })

    const receipt = await pay()

    expect(receipt.error).toBeUndefined()

    const serverConnection = await connectionPromise
    const totalReceived = BigInt(serverConnection.totalReceived)
    expect(totalReceived).toBe(amountToDeliver.value)
    expect(receipt.amountDelivered.value).toBe(amountToDeliver.value)
    expect(receipt.amountSent.value).toBeLessThanOrEqual(maxSourceAmount.value)

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
    let aliceBackend: CustomBackend
    const aliceDeps = reduct((Constructor) => Constructor.name === 'RateBackend' && aliceBackend)
    aliceBackend = new CustomBackend(aliceDeps)
    aliceBackend.setPrices(prices)

    const aliceConnector = createApp(
      {
        ilpAddress: 'test.alice',
        defaultRoute: 'bob',
        spread: 0.005, // 0.5%
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
      aliceDeps
    )

    // Override with rate backend for custom rates
    let bobBackend: CustomBackend
    const bobDeps = reduct((Constructor) => Constructor.name === 'RateBackend' && bobBackend)
    bobBackend = new CustomBackend(bobDeps)
    bobBackend.setPrices(prices)

    const bobConnector = createApp(
      {
        ilpAddress: 'test.bob',
        spread: 0.0031, // 0.31%
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
      bobDeps
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

    const amountToDeliver = Int.from(10_000_000_000)! // 10 XRP, ~$2 at given prices
    const { quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alicePlugin1,
    })
    const { pay, maxSourceAmount, minExchangeRate } = await quote({
      amountToDeliver,
      sourceAsset: {
        assetCode: 'BTC',
        assetScale: 8,
      },
      slippage: 0.0085,
      prices,
    })

    const receipt = await pay()

    expect(receipt.error).toBeUndefined()

    const serverConnection = await connectionPromise
    const totalReceived = BigInt(serverConnection.totalReceived)
    expect(receipt.amountDelivered.value).toBe(totalReceived)

    // Ensure at least the invoice amount was delivered
    expect(receipt.amountDelivered.value).toBeGreaterThanOrEqual(amountToDeliver.value)

    // Ensure over-delivery is minimized to the equivalent of a single source unit, 1 satoshi,
    // converted into destination units:
    const maxOverDeliveryAmount =
      BigInt(
        Math.ceil(
          // 1 sat -> BTC -> XRP -> drops
          minExchangeRate * 10 ** (9 - 8)
        )
      ) + amountToDeliver.value

    expect(receipt.amountDelivered.value).toBeLessThanOrEqual(maxOverDeliveryAmount)
    expect(receipt.amountSent.value).toBeLessThanOrEqual(maxSourceAmount.value)

    await aliceConnector.shutdown()
    await bobConnector.shutdown()

    await streamServer.close()
  }, 10000)

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

    const { quote } = await setupPayment({
      plugin: senderPlugin1,
      destinationAddress,
      sharedSecret,
    })
    const { pay } = await quote({
      amountToDeliver: Int.from(100_0000),
      sourceAsset: {
        assetCode: 'ABC',
        assetScale: 4,
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

    const { quote } = await setupPayment({
      plugin: senderPlugin1,
      destinationAddress,
      sharedSecret,
    })
    await expect(
      quote({
        amountToDeliver: Int.from(100_0000),
        sourceAsset: {
          assetCode: 'ABC',
          assetScale: 4,
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

    // STREAM "receiver" that just fulfills packets
    let totalReceived = 0n
    receiverPlugin2.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)

      const fulfillment = await generateFulfillment(fulfillmentKey, prepare.data)
      const isFulfillable = prepare.executionCondition.equals(await hash(fulfillment))

      const streamPacket = await Packet.decryptAndDeserialize(encryptionKey, prepare.data)

      if (isFulfillable) {
        // On fulfillable packets, fulfill *without valid STREAM data*
        totalReceived += Int.from(streamPacket.prepareAmount)!.value
        return serializeIlpFulfill({
          fulfillment,
          data: randomBytes(200),
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

    const { quote } = await setupPayment({
      plugin: senderPlugin1,
      destinationAddress,
      sharedSecret,
    })
    const { pay, maxSourceAmount } = await quote({
      // Amount much larger than max packet, so test will fail unless sender fails fast
      amountToDeliver: Int.from(1000000),
      sourceAsset: {
        assetCode: 'ABC',
        assetScale: 0,
      },
      slippage: 0.1,
      prices: {},
    })

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.ReceiverProtocolViolation)
    expect(receipt.amountDelivered.value).toBe(totalReceived)
    expect(receipt.amountSent.value).toBeLessThanOrEqual(maxSourceAmount.value)

    await app.shutdown()
  }, 10000)

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
    let totalReceived = 0n
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

    const { quote } = await setupPayment({
      plugin: senderPlugin1,
      destinationAddress,
      sharedSecret,
    })
    const { pay, maxSourceAmount } = await quote({
      // Amount much larger than max packet, so test will fail unless sender fails fast
      amountToDeliver: Int.from(100000),
      sourceAsset: {
        assetCode: 'ABC',
        assetScale: 0,
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

    const { quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: senderPlugin1,
    })
    const { pay } = await quote({
      amountToDeliver: Int.from(10_0000), // 10 EUR
      sourceAsset: {
        assetCode: 'USD',
        assetScale: 4,
      },
      slippage: 0.015, // 1.5% slippage allowed
      prices,
    })

    const serverConnection = await connectionPromise

    // Change exchange rate to 0 before the payment begins
    backend.setSpread(1)

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.InsufficientExchangeRate)
    expect(receipt.amountSent.value).toBe(0n)
    expect(receipt.amountDelivered.value).toBe(0n)
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

    const { quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: senderPlugin1,
    })
    const { pay, maxSourceAmount } = await quote({
      amountToDeliver: Int.from(10_0000), // 10 EUR
      sourceAsset: {
        assetCode: 'USD',
        assetScale: 4,
      },
      slippage: 0.015, // 1.5% slippage allowed
      prices,
    })

    const serverConnection = await connectionPromise

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.InsufficientExchangeRate)
    expect(receipt.amountDelivered.value).toBeLessThan(10_0000n)
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
      assetCode: 'ABC',
      assetScale: 0,
    }
    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      accounts: {
        default: {
          relation: 'child',
          ...asset,
          plugin: receiverPlugin,
        },
      },
    })
    await app.listen()

    const { quote } = await setupPayment({
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

    const { quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: senderPlugin1,
    })
    const { pay } = await quote({
      amountToSend: 100,
      sourceAsset: {
        assetCode: 'USD',
        assetScale: 2,
      },
      slippage: 1,
      prices: {},
    })
    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent.value).toBe(100n)
    expect(receipt.amountDelivered.value).toBe(100n)

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
    const { quote } = await setupPayment({
      plugin: senderPlugin1,
      sharedSecret,
      destinationAddress,
    })
    const { pay } = await quote({
      amountToSend,
      sourceAsset: {
        assetCode: 'ABC',
        assetScale: 0,
      },
      slippage: 1,
      prices: {},
    })

    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(+receipt.amountSent).toBe(amountToSend)

    await app.shutdown()
    await streamServer.close()
  }, 20000)

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

    const { quote } = await setupPayment({
      plugin: senderPlugin1,
      sharedSecret,
      destinationAddress,
    })
    const { pay } = await quote({
      amountToSend: 10,
      sourceAsset: {
        assetCode: 'ABC',
        assetScale: 0,
      },
    })

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.IdleTimeout)
    expect(receipt.amountSent.value).toBe(0n)

    await app.shutdown()
    await streamServer.close()
  }, 15000)

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

    expect(controller.nextState(DEFAULT_REQUEST)).toBe(PaymentError.ExceededMaxSequence)
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

    const { quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })
    const { pay } = await quote({
      amountToSend: 1000000000,
      sourceAsset: {
        assetCode: 'USD',
        assetScale: 2,
      },
      slippage: 1,
      prices: {},
    })
    const receipt = await pay()

    expect(receipt.error).toBe(PaymentError.ClosedByRecipient)
    expect(receipt.amountSent.value).toBe(20n) // Only $0.20 was sent & received
    expect(receipt.amountDelivered.value).toBe(20n)

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

    const { quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })
    const { pay } = await quote({
      amountToSend: 100000000000,
      sourceAsset: {
        assetCode: 'ABC',
        assetScale: 0,
      },
      slippage: 1,
      prices: {},
    })

    // End the connection after 1 second
    const serverConnection = await connectionPromise
    setTimeout(() => serverConnection.end(), 500)

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.ClosedByRecipient)
    expect(receipt.amountSent.value).toBeGreaterThan(1n)
    expect(receipt.amountSent.value).toBeLessThan(100n)
    expect(receipt.amountSent.value).toBe(receipt.amountDelivered.value) // 1:1 rate

    await app.shutdown()
    await streamServer.close()
  }, 10000)
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

    const amountToSend = 10_000n // 10,000 units, 1,000 max packet => ~10 packets
    const { quote } = await setupPayment({
      destinationAddress,
      sharedSecret,
      plugin: alice1,
    })
    const { pay } = await quote({
      amountToSend,
      sourceAsset: {
        assetCode: 'ABC',
        assetScale: 0,
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
        totalReceived: receipt.amountDelivered.toLong(),
      })
    )

    await app.shutdown()
    await streamServer.close()
  })

  it('reports receipts received out of order', async () => {
    const [senderPlugin, receiverPlugin] = MirrorPlugin.createPair()

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

      // First, sign a STREAM receipt for 10 units, then a receipt for 5 units
      moneyOrReply.setTotalReceived(signedFirstReceipt ? 10 : 5)
      signedFirstReceipt = true
      return serializeIlpReply(moneyOrReply.accept())
    })

    const { quote } = await setupPayment({
      plugin: senderPlugin,
      sharedSecret,
      destinationAddress,
      destinationAsset: {
        assetCode: 'ABC',
        assetScale: 4,
      },
    })
    const { pay } = await quote({
      amountToDeliver: 20,
      sourceAsset: {
        assetCode: 'ABC',
        assetScale: 4,
      },
      slippage: 0.5,
    })

    const { amountDelivered, streamReceipt } = await pay()
    expect(amountDelivered.value).toBe(20n)
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
    const controller = new ReceiptController()
    const log = createLogger('ilp-pay')

    // Mock sending a requset, reply with invalid STREAM receipt
    const handler = controller.applyRequest()
    handler(new StreamFulfill(log, [new StreamReceiptFrame(1, randomBytes(32))], Int.ZERO))

    expect(controller.getReceipt()).toBeUndefined()
  })
})

describe('interledger.rs integration', () => {
  it.skip('pays to SPSP server', async () => {
    // TODO Switch all of this over to custom Docker network after this PR is merged:
    // https://github.com/testcontainers/testcontainers-node/pull/76
    // (Note: don't use the default bridge network since it doesn't resolve
    //  hostnames and requires knowing the container IP addresses, but `testcontainers`
    //  won't give me access to that... even `getContainerIpAddress()` just returns
    //  localhost!)

    const network = await new Network().start()

    // Setup Redis
    const redisContainer = await new GenericContainer('redis')
      .withExposedPorts(6379)
      .withName('redis')
      .withNetworkMode(network.getName())
      .start()

    // Setup the Rust connector
    const adminAuthToken = 'admin'
    const rustNodeContainer = await new GenericContainer('interledgerrs/ilp-node', 'latest')
      .withEnv('ILP_SECRET_SEED', randomBytes(32).toString('hex'))
      .withEnv('ILP_ADMIN_AUTH_TOKEN', adminAuthToken)
      .withEnv('ILP_DATABASE_URL', `redis://redis:6379`)
      .withEnv('ILP_ILP_ADDRESS', 'g.corp')
      .withNetworkMode(network.getName())
      .withWaitStrategy(Wait.forLogMessage('HTTP API listening'))
      .start()

    const host = `${rustNodeContainer.getContainerIpAddress()}:${rustNodeContainer.getMappedPort(
      7770
    )}`

    // Create receiver account
    await Axios.post(
      `http://${host}/accounts`,
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
        url: `http://${host}/accounts/sender/ilp`,
        staticToken: 'password',
      },
    })
    await plugin.connect()

    // Create account for sender to connect to
    await Axios.post(
      `http://${host}/accounts`,
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

    const amountToSend = 100_000n // 0.1 EUR, ~50 packets @ max packet amount of 2000
    const { quote } = await setupPayment({
      plugin,
      paymentPointer: `http://${host}/accounts/receiver/spsp`,
    })
    const { pay } = await quote({
      amountToSend,
      sourceAsset: {
        assetCode: 'EUR',
        assetScale: 6,
      },
    })

    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent.value).toBe(amountToSend)
    expect(receipt.amountDelivered.value).toBe(amountToSend) // Exchange rate is 1:1

    // Check the balance
    const { data } = await Axios({
      method: 'GET',
      url: `http://${host}/accounts/receiver/balance`,
      headers: {
        Authorization: 'Bearer password',
      },
    })
    // Interledger.rs balances are also in normal units
    expect(data.balance).toBe(amountToSend)

    await plugin.disconnect()

    await redisContainer.stop()
    await rustNodeContainer.stop()

    await network.stop()
  }, 30000)
})

describe('interledger4j integration', () => {
  it.skip('pays to SPSP server', async () => {
    // Setup Redis
    const redisContainer = await new GenericContainer('redis').withExposedPorts(6379).start()
    const redisPort = redisContainer.getMappedPort(6379)

    // Setup the Java connector
    const adminPassword = 'admin'
    const connectorContainer = await new GenericContainer(
      'interledger4j/java-ilpv4-connector',
      '0.5.0'
    )
      .withEnv('redis.host', `redis://localhost:${redisPort}`)
      .withEnv('interledger.connector.adminPassword', adminPassword)
      .withEnv('interledger.connector.spsp.serverSecret', randomBytes(32).toString('base64'))
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
        assetCode: 'XRP',
        assetScale: '9',
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
        assetScale: '6',
        maximumPacketAmount: '400000', // $0.40
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

    const amountToSend = 98_000_000n // $98
    const { quote, destinationAsset } = await setupPayment({
      plugin,
      paymentPointer: `http://localhost:8080/receiver`,
    })
    const { pay, maxSourceAmount, minDeliveryAmount } = await quote({
      amountToSend,
      sourceAsset: {
        assetCode: 'USD',
        assetScale: 6,
      },
    })

    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent.value).toBe(amountToSend)
    expect(receipt.amountSent.value).toBeLessThanOrEqual(maxSourceAmount.value)

    // Check the balance
    const { data } = await Axios({
      method: 'GET',
      url: `http://localhost:8080/accounts/receiver/balance`,
      auth: {
        username: 'admin',
        password: adminPassword,
      },
    })

    const netBalance = BigInt(data.accountBalance.netBalance)
    expect(receipt.amountDelivered.value).toEqual(netBalance)
    expect(minDeliveryAmount.value).toBeLessThanOrEqual(netBalance)

    await plugin.disconnect()

    await connectorContainer.stop()
    await redisContainer.stop()
  }, 60000)
})

// TODO Move this to a separate file
describe('utils', () => {
  it('Int#from', () => {
    expect(Int.from(Int.ONE)).toEqual(Int.ONE)
    expect(Int.from(Int.MAX_U64)).toEqual(Int.MAX_U64)

    expect(Int.from('1000000000000000000000000000000000000')?.value).toBe(
      1000000000000000000000000000000000000n
    )
    expect(Int.from('1')?.value).toBe(1n)
    expect(Int.from('0')?.value).toBe(0n)
    expect(Int.from('-2')).toBeUndefined()
    expect(Int.from('2.14')).toBeUndefined()
  })

  it('Ratio#reciprocal', () => {
    expect(new Ratio(Int.ONE, Int.TWO).reciprocal()).toEqual(new Ratio(Int.TWO, Int.ONE))
    expect(new Ratio(Int.TWO, Int.ONE).reciprocal()).toEqual(new Ratio(Int.ONE, Int.TWO))
    expect(new Ratio(Int.ZERO, Int.ONE).reciprocal()).toBeUndefined()
  })

  it('Ratio#toString', () => {
    expect(new Ratio(Int.from(4)!, Int.ONE).toString()).toBe('4')
    expect(new Ratio(Int.ONE, Int.TWO).toString()).toBe('0.5')
    expect(new Ratio(Int.ONE, Int.from(3) as PositiveInt).toString()).toBe((1 / 3).toString())
  })
})
