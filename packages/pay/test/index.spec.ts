/* eslint-disable prefer-const, @typescript-eslint/no-empty-function, @typescript-eslint/no-non-null-assertion */
import { createApp } from 'ilp-connector'
import BigNumber from 'bignumber.js'
import { Connection, createServer, DataAndMoneyStream } from 'ilp-protocol-stream'
import Long from 'long'
import reduct from 'reduct'
import { CustomBackend } from './helpers/rate-backend'
import { MirrorPlugin } from './helpers/plugin'
import { fetchCoinCapRates } from '../src/rates/coincap'
import { quote, PaymentError } from '../src'
import { describe, it, expect, jest } from '@jest/globals'
import {
  serializeIlpFulfill,
  deserializeIlpPrepare,
  serializeIlpReject,
  IlpError,
} from 'ilp-packet'
import { sleep, Int, Ratio, PositiveInt } from '../src/utils'
import {
  randomBytes,
  generateFulfillment,
  generateFulfillmentKey,
  generatePskEncryptionKey,
  hash,
} from 'ilp-protocol-stream/dist/src/crypto'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { serializeIldcpResponse } from 'ilp-protocol-ildcp'
import {
  Packet,
  IlpPacketType,
  ConnectionAssetDetailsFrame,
} from 'ilp-protocol-stream/dist/src/packet'
import { GenericContainer, Wait, Network } from 'testcontainers'
import Axios from 'axios'
import PluginHttp from 'ilp-plugin-http'
import getPort from 'get-port'
import { Writer } from 'oer-utils'
import nock from 'nock'
import { v4 as uuid } from 'uuid'
import { fetchPaymentDetails } from '../src/open-payments'
import { SequenceController } from '../src/controllers/sequence'
import { StreamRequestBuilder } from '../src/controllers'
import createLogger from 'ilp-logger'

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

    const details = await quote({
      invoiceUrl,
      plugin: senderPlugin1,
      prices,
    })
    expect(details.minDeliveryAmount).toEqual(new BigNumber(4.5601))
    expect(details.invoice).toMatchObject({
      invoiceUrl,
      accountUrl,
      expiresAt,
      description,
      amountDelivered: new BigNumber(0),
      amountToDeliver: new BigNumber(4.5601),
    })
    expect(details.destinationAccount).toMatchObject({
      assetCode: 'USD',
      assetScale: 4,
    })
    expect(typeof details.destinationAccount.ilpAddress).toBe('string')
    expect(connectionHandler).toBeCalledTimes(1)

    await details.cancel()
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

    await expect(
      quote({
        invoiceUrl,
        plugin: senderPlugin,
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

  it('fails if no way to fetch STREAM credentials was provided', async () => {
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
      .matchHeader('Accept', (v) => v.includes('application/ilp-stream+json'))
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

  it('resolves credentials from SPSP as fallback', async () => {
    // Open Payments response is invalid
    const scope1 = nock('https://alice.mywallet.com')
      .get('/.well-known/open-payments')
      .matchHeader('Accept', (v) => v.includes('application/ilp-stream+json'))
      .reply(200, {
        errorMessage: 'CRITICAL ERROR',
      })

    // SPSP response is valid, but is returned after Open Payments response
    const scope2 = nock('https://alice.mywallet.com')
      .get('/.well-known/pay')
      .matchHeader('Accept', (v) => v.includes('application/spsp4+json'))
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
    scope1.done()
    scope2.done()
  })

  it('fails if both account queries fail', async () => {
    const scope = nock('https://open.mywallet.com').get(/.*/).twice().reply(500)
    await expect(fetchPaymentDetails({ paymentPointer: '$open.mywallet.com' })).resolves.toBe(
      PaymentError.QueryFailed
    )
    scope.done()
  })

  it('fails if both account queries timeout', async () => {
    const scope = nock('https://open.mywallet.com').get(/.*/).twice().delay(7000).reply(500)
    await expect(fetchPaymentDetails({ paymentPointer: '$open.mywallet.com' })).resolves.toBe(
      PaymentError.QueryFailed
    )
    scope.done()
    nock.abortPendingRequests()
  })

  it('fails if both account queries return invalid responses', async () => {
    const scope = nock('https://example.com/foo').get(/.*/).reply(200, 'this is a string')
    await expect(fetchPaymentDetails({ paymentPointer: '$example.com/foo' })).resolves.toBe(
      PaymentError.QueryFailed
    )
    scope.done()

    // Invalid Open Payments response, doesn't support credentials/ilp+stream accept header
    const scope1 = nock('https://alice.mywallet.com').get('/.well-known/open-payments').reply(200, {
      id: 'https://alice.mywallet.com/',
      accountServicer: 'https://mywallet.com/',
      assetCode: 'RMB',
      assetScale: 10,
    })

    // Invalid shared secret in SPSP response
    const scope2 = nock('https://alice.mywallet.com').get('/.well-known/pay').reply(200, {
      destination_account: 'g.foo',
      shared_secret: 'Zm9v',
    })

    await expect(fetchPaymentDetails({ paymentPointer: '$alice.mywallet.com' })).resolves.toBe(
      PaymentError.QueryFailed
    )
    scope1.done()
    scope2.done()
  })

  it('follows spsp redirect', async () => {
    const scope1 = nock('https://wallet1.example/').get('/.well-known/pay').reply(
      301,
      {},
      {
        Location: 'https://wallet2.example/.well-known/pay',
      }
    )

    const scope2 = nock('https://wallet2.example/')
      .get('/.well-known/pay')
      .matchHeader('Accept', (v) => v.includes('application/spsp4+json'))
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
it.todo('fails if the invoice was already paid')
it.todo('fails if the invoice expires before the payment can complete')

describe('quoting flow', () => {
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
    ).rejects.toBe(PaymentError.QueryFailed)
  })

  it('fails if SPSP response is invalid', async () => {
    const scope = nock('http://example.com').get('/foo').reply(200, { meh: 'why?' })

    await expect(
      quote({
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
      .matchHeader('Accept', (v) => v.includes('application/spsp4+json'))
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

    const details = await quote({
      paymentPointer: 'https://example.com',
      plugin: senderPlugin1,
      amountToSend: new BigNumber(1000),
    })

    // Connection should be able to be established after resolving payment pointer
    expect(connectionHandler.mock.calls.length).toBe(1)
    scope.done()

    await details.cancel()
    expect(!senderPlugin1.isConnected())

    await app.shutdown()
    await streamServer.close()
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
      async sendData() {
        // Handle IL-DCP requests
        // Return invalid ILP address
        return serializeIldcpResponse({
          clientAddress: 'private',
          assetCode: 'USD',
          assetScale: 2,
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
    ).rejects.toBe(PaymentError.IncompatibleInterledgerNetworks)
    expect(!senderPlugin.isConnected())

    await app.shutdown()
  })

  it('fails if amount to send is not a positive integer', async () => {
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

  it('fails if amount to deliver is not a positive integer', async () => {
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

    // Fails with 0 delivery amount
    await expect(
      quote({
        plugin: senderPlugin,
        amountToDeliver: Int.ZERO,
        destinationAddress: 'private.foo',
        sharedSecret: Buffer.alloc(32),
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

    const sharedSecret = randomBytes(32)
    const encryptionKey = await generatePskEncryptionKey(sharedSecret)

    // Create simple STREAM receiver that acks test packets,
    // but replies with conflicting asset details
    receiverPlugin2.registerDataHandler(async (data) => {
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
      quote({
        plugin: senderPlugin1,
        amountToDeliver: Int.from(100_0000),
        destinationAddress: 'private.larry.receiver',
        sharedSecret,
      })
    ).rejects.toBe(PaymentError.DestinationAssetConflict)

    expect(!senderPlugin1.isConnected())

    await app.shutdown()
    await streamServer.close()
  })

  it('fails if no test packets are delivered', async () => {
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

    receiverPlugin2.registerDataHandler(async () =>
      serializeIlpReject({
        code: IlpError.T01_PEER_UNREACHABLE,
        message: '',
        triggeredBy: '',
        data: Buffer.alloc(0),
      })
    )

    await expect(
      quote({
        plugin: senderPlugin1,
        amountToSend: '1000',
        destinationAddress: 'private.larry.receiver',
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.RateProbeFailed)
    expect(!senderPlugin1.isConnected())

    await app.shutdown()
  }, 15000)

  it('fails if max packet amount is 0', async () => {
    const [senderPlugin1, maxPacketPlugin] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const senderPlugin2 = new MirrorPlugin()
    senderPlugin2.mirror = senderPlugin1

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

    const {
      sharedSecret,
      destinationAccount: destinationAddress,
    } = streamServer.generateAddressAndSecret()

    // `ilp-connector` doesn't support 0 max packet amount,
    // so use a custom middleware to test this
    maxPacketPlugin.registerDataHandler(async (data) => {
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
        return senderPlugin2.dataHandler(data)
      }
    })

    await expect(
      quote({
        plugin: senderPlugin1,
        amountToSend: 100,
        destinationAddress,
        sharedSecret,
      })
    ).rejects.toBe(PaymentError.ConnectorError)
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

      await expect(
        quote({
          plugin: senderPlugin1,
          amountToSend: 100,
          destinationAddress,
          sharedSecret,
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

  it('fails if no external price for the source asset exists', async () => {
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

  it('fails if no external price for the destination asset exists', async () => {
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

    await expect(
      quote({
        plugin: senderPlugin1,
        amountToSend: '1000',
        destinationAddress,
        sharedSecret,
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

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0.02,
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
        amountToSend: '1000',
        destinationAddress,
        sharedSecret,
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

    const app = createApp(
      {
        ilpAddress: 'private.larry',
        // All packets here should round down to 0 EUR
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

    await expect(
      quote({
        plugin: senderPlugin1,
        amountToSend: '1000',
        destinationAddress,
        sharedSecret,
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

    const app = createApp(
      {
        ilpAddress: 'private.larry',
        spread: 0.0005,
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

    await expect(
      quote({
        plugin: senderPlugin1,
        amountToSend: 100_000,
        destinationAddress,
        sharedSecret,
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

    const amountToSend = new BigNumber(1.00427)
    const { pay, ...quoteDetails } = await quote({
      amountToSend,
      destinationAddress,
      sharedSecret,
      plugin: alice1,
      slippage: 0.015,
      prices,
    })

    expect(quoteDetails.sourceAccount).toEqual({
      assetCode: 'USD',
      assetScale: 6,
      ilpAddress: 'test.larry.alice',
    })
    expect(quoteDetails.destinationAccount).toEqual({
      assetCode: 'XRP',
      assetScale: 9,
      ilpAddress: destinationAddress,
    })
    expect(quoteDetails.maxSourceAmount).toEqual(amountToSend)

    const receipt = await pay()

    expect(receipt.error).toBeUndefined()

    const serverConnection = await connectionPromise
    expect(new BigNumber(serverConnection.totalReceived)).toEqual(
      receipt.amountDelivered.shiftedBy(9)
    )
    expect(receipt.amountSent).toEqual(amountToSend)

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

    const { pay, ...details } = await quote({
      plugin: senderPlugin1,
      // Send 100,002 sats
      // Max packet amount of 1000 means the final packet will try to send 2 units
      // This rounds down to 0, but the delivery shortfall should ensure this is acceptable
      amountToSend: 0.00100002,
      destinationAddress,
      sharedSecret,
      slippage: 0.002,
      prices,
    })
    expect(+details.maxSourceAmount).toBe(0.00100002)

    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(+receipt.amountSent).toBe(0.00100002)
    expect(+receipt.amountDelivered).toBeGreaterThanOrEqual(+details.minDeliveryAmount)

    await app.shutdown()
    await streamServer.close()
  })

  it('complete source amount payment with no latency', async () => {
    const [alice1, alice2] = MirrorPlugin.createPair(0, 0)
    const [bob1, bob2] = MirrorPlugin.createPair(0, 0)

    const prices = await fetchCoinCapRates()

    // Override with rate backend for custom rates
    let backend: CustomBackend
    const deps = reduct((Constructor) => Constructor.name === 'RateBackend' && backend)
    backend = new CustomBackend(deps)
    backend.setPrices(prices)

    const app = createApp(
      {
        ilpAddress: 'test.larry',
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
      slippage: 1,
      prices: {},
    })

    const receipt = await pay()

    expect(receipt.error).toBeUndefined()
    expect(highestNumberPacketsInFlight).toBe(20)
    expect(+receipt.amountSent).toEqual(100)

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
    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent).toEqual(amountToSend)
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

    const { pay, ...quoteDetails } = await quote({
      amountToDeliver,
      destinationAddress,
      sharedSecret,
      slippage: 0.015,
      plugin: alice1,
      prices,
    })

    const receipt = await pay()

    expect(receipt.error).toBeUndefined()

    const serverConnection = await connectionPromise
    const totalReceived = new BigNumber(serverConnection.totalReceived)
    expect(+totalReceived).toBe(+amountToDeliver)
    expect(+receipt.amountDelivered).toBe(0.00107643)
    expect(+receipt.amountSent).toBeLessThanOrEqual(+quoteDetails.maxSourceAmount)

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
    const { pay, ...quoteDetails } = await quote({
      plugin: alicePlugin1,
      amountToDeliver,
      destinationAddress,
      sharedSecret,
      slippage: 0.0085,
      prices,
    })

    const receipt = await pay()

    expect(receipt.error).toBeUndefined()

    const serverConnection = await connectionPromise
    const totalReceived = new BigNumber(serverConnection.totalReceived).shiftedBy(-9)
    expect(receipt.amountDelivered).toEqual(totalReceived)

    // Ensure at least the invoice amount was delivered
    expect(+receipt.amountDelivered).toBeGreaterThanOrEqual(10)

    // Ensure over-delivery is minimized to the equivalent of a single source unit, 1 satoshi:
    const maxOverDeliveryAmount = new BigNumber(1)
      .shiftedBy(-8) // Sats -> BTC
      .times(quoteDetails.minExchangeRate) // BTC -> XRP
      .shiftedBy(9) // XRP -> drops
      .integerValue(BigNumber.ROUND_CEIL)
      .plus(amountToDeliver.toString())
    expect(+receipt.amountDelivered).toBeLessThanOrEqual(+maxOverDeliveryAmount)

    expect(+receipt.amountSent).toBeLessThanOrEqual(+quoteDetails.maxSourceAmount)

    await aliceConnector.shutdown()
    await bobConnector.shutdown()

    await streamServer.close()
  }, 10000)

  // TODO This should error during the quoting flow, but JS stream only returns `StreamMaxMoney` if the packet sent money!
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
      amountToDeliver: Int.from(100_0000),
      destinationAddress,
      sharedSecret,
    })

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

    await expect(
      quote({
        plugin: senderPlugin1,
        amountToDeliver: Int.from(100_0000),
        destinationAddress,
        sharedSecret,
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
    let totalReceived = 0
    receiverPlugin2.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)

      const fulfillment = await generateFulfillment(fulfillmentKey, prepare.data)
      const isFulfillable = prepare.executionCondition.equals(await hash(fulfillment))

      const streamPacket = await Packet.decryptAndDeserialize(encryptionKey, prepare.data)

      if (isFulfillable) {
        // On fulfillable packets, fulfill *without valid STREAM data*
        totalReceived += +streamPacket.prepareAmount
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

    const { pay, ...quoteDetails } = await quote({
      plugin: senderPlugin1,
      // Amount much larger than max packet, so test will fail unless sender fails fast
      amountToDeliver: Int.from(1000000),
      destinationAddress,
      sharedSecret,
      slippage: 0.1,
      prices: {},
    })

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.ReceiverProtocolViolation)
    expect(+receipt.amountDelivered).toEqual(totalReceived)
    expect(+receipt.amountSent).toBeLessThanOrEqual(+quoteDetails.maxSourceAmount)

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
    let totalReceived = 0
    receiverPlugin2.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)

      const fulfillment = await generateFulfillment(fulfillmentKey, prepare.data)
      const isFulfillable = prepare.executionCondition.equals(await hash(fulfillment))

      const streamPacket = await Packet.decryptAndDeserialize(encryptionKey, prepare.data)

      if (isFulfillable) {
        // On fulfillable packets, fulfill, but lie and say we only received 1 unit
        totalReceived += +streamPacket.prepareAmount
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

    const { pay, ...quoteDetails } = await quote({
      plugin: senderPlugin1,
      // Amount much larger than max packet, so test will fail unless sender fails fast
      amountToDeliver: Int.from(100000),
      destinationAddress,
      sharedSecret,
      slippage: 0.2,
    })

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.ReceiverProtocolViolation)
    expect(+receipt.amountDelivered).toEqual(totalReceived)
    expect(+receipt.amountSent).toBeLessThanOrEqual(+quoteDetails.maxSourceAmount)

    await app.shutdown()
  })

  it('fails if the exchange rate drops to 0 during the payment', async () => {
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

    const { pay, ...quoteDetails } = await quote({
      amountToDeliver: Int.from(10_0000), // 10 EUR
      destinationAddress,
      sharedSecret,
      slippage: 0.015, // 1.5% slippage allowed
      plugin: senderPlugin1,
      prices,
    })

    const serverConnection = await connectionPromise

    // Change exchange rate to 0 before the payment begins
    backend.setSpread(1)

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.InsufficientExchangeRate)
    expect(+receipt.amountDelivered).toBe(0)
    expect(+receipt.amountDelivered).toBe(+serverConnection.totalReceived / 10000)
    expect(+receipt.amountSent).toBeLessThanOrEqual(+quoteDetails.maxSourceAmount)

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

    const { pay, ...quoteDetails } = await quote({
      amountToDeliver: Int.from(10_0000), // 10 EUR
      destinationAddress,
      sharedSecret,
      slippage: 0.015, // 1.5% slippage allowed
      plugin: senderPlugin1,
      prices,
    })

    const serverConnection = await connectionPromise

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.InsufficientExchangeRate)
    expect(+receipt.amountDelivered).toBeLessThan(10)
    expect(+receipt.amountDelivered).toBe(+serverConnection.totalReceived / 10000)
    expect(+receipt.amountSent).toBeLessThanOrEqual(+quoteDetails.maxSourceAmount)

    await app.shutdown()
    await streamServer.close()
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
        destinationAddress: 'private.unknown', // Non-routable address
        sharedSecret: Buffer.alloc(32),
      })
    ).rejects.toBe(PaymentError.ConnectorError)

    await app.shutdown()
  })

  it('handles plugin disconnect errors', async () => {
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

    await expect(
      quote({ plugin, sharedSecret: Buffer.alloc(32), destinationAddress: 'private.foo' })
    ).rejects.toBe(PaymentError.UnknownSourceAsset)
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
      } else {
        return streamServerPlugin.dataHandler(data)
      }
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

    const { pay } = await quote({
      amountToSend: new BigNumber(1),
      destinationAddress,
      sharedSecret,
      plugin: senderPlugin1,
      slippage: 1,
      prices: {},
    })
    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(+receipt.amountSent).toEqual(1)
    expect(+receipt.amountDelivered).toEqual(1)

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
          // Limit to 1 packet / 200ms
          // should ensure a T05 error is encountered
          rateLimit: {
            capacity: 1,
            refillCount: 1,
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
    const { pay } = await quote({
      plugin: senderPlugin1,
      amountToSend,
      sharedSecret,
      destinationAddress,
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

  it('ends payment if the sequence number exceeds encryption safety', async () => {
    const log = createLogger('sequence')
    const controller = new SequenceController()

    controller.applyRequest({
      sequence: 2 ** 32 - 1,
      sourceAmount: Int.ZERO,
      minDestinationAmount: Int.ZERO,
      requestFrames: [],
      isFulfillable: false,
      log,
    })

    expect(controller.nextState(new StreamRequestBuilder(log, () => {}))).toBe(
      PaymentError.ExceededMaxSequence
    )
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

    const { pay } = await quote({
      amountToSend: new BigNumber(10000000),
      destinationAddress,
      sharedSecret,
      plugin: alice1,
      slippage: 1,
      prices: {},
    })
    const receipt = await pay()

    expect(receipt.error).toBe(PaymentError.ClosedByRecipient)
    expect(receipt.amountSent).toEqual(new BigNumber(0.2)) // Only $0.20 was received
    expect(receipt.amountDelivered).toEqual(new BigNumber(0.2)) // Only $0.20 was received

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
      slippage: 1,
      plugin: alice1,
      prices: {},
    })

    // End the connection after 1 second
    const serverConnection = await connectionPromise
    setTimeout(() => serverConnection.end(), 500)

    const receipt = await pay()
    expect(receipt.error).toBe(PaymentError.ClosedByRecipient)
    expect(receipt.amountSent.isGreaterThan(1))
    expect(receipt.amountSent.isLessThan(100))
    expect(receipt.amountSent).toEqual(receipt.amountDelivered)

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
    const rustNodeContainer = await new GenericContainer('interledgerrs/ilp-node', 'latest')
      .withEnv('ILP_SECRET_SEED', randomBytes(32).toString('hex'))
      .withEnv('ILP_ADMIN_AUTH_TOKEN', adminAuthToken)
      .withEnv('ILP_DATABASE_URL', `redis://localhost:${redisPort}`)
      .withEnv('ILP_ILP_ADDRESS', 'g.corp')
      .withNetworkMode('host')
      .withWaitStrategy(Wait.forLogMessage('HTTP API listening'))
      .start()

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
    await plugin.connect()

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
    expect(receipt.error).toBeUndefined()
    expect(+receipt.amountSent).toBe(amountToSend)
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

    const amountToSend = 98 // $98
    const { pay, ...details } = await quote({
      plugin,
      paymentPointer: `http://localhost:8080/receiver`,
      amountToSend,
    })

    const receipt = await pay()
    expect(receipt.error).toBeUndefined()
    expect(receipt.amountSent.isEqualTo(amountToSend))
    expect(receipt.amountSent.isLessThanOrEqualTo(details.maxSourceAmount))
    expect(receipt.sourceAccount.assetCode).toBe('USD')
    expect(receipt.sourceAccount.assetScale).toBe(6)
    expect(receipt.destinationAccount.assetCode).toBe('XRP')
    expect(receipt.destinationAccount.assetScale).toBe(9)

    // // Check the balance
    const { data } = await Axios({
      method: 'GET',
      url: `http://localhost:8080/accounts/receiver/balance`,
      auth: {
        username: 'admin',
        password: adminPassword,
      },
    })

    expect(+data.accountBalance.netBalance).toEqual(+receipt.amountDelivered.shiftedBy(9))
    expect(+data.accountBalance.netBalance).toBeGreaterThanOrEqual(+details.minDeliveryAmount)

    await plugin.disconnect()

    await connectorContainer.stop()
    await redisContainer.stop()
  }, 60000)
})

describe('utils', () => {
  it('Int#from', () => {
    expect(Int.from('1000000000000000000000000000000000000')).toBeInstanceOf(Int)
    expect(Int.from('1')).toBeInstanceOf(Int)
    expect(Int.from('0')).toBeInstanceOf(Int)
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
    expect(new Ratio(Int.ONE, Int.from(3) as PositiveInt).toString()).toBe('0.3333333333')
  })
})
