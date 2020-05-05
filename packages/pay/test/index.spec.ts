import { createApp } from '@kincaidoneil/ilp-connector'
import RateBackend from '@kincaidoneil/ilp-connector/dist/services/rate-backend'
import BigNumber from 'bignumber.js'
import { Connection, createServer, DataAndMoneyStream } from 'ilp-protocol-stream'
import Long from 'long'
import reduct from 'reduct'
import { CustomBackend } from './rate-backend'
import { MirrorPlugin } from './plugin'
import { fetchCoinCapRates } from '../src/rates/coincap'
import { getRate } from '../src/rates'
import { quote } from '../src'
import { test, expect } from '@jest/globals'

test('completes source amount payment with max packet amount', async () => {
  const alice1 = new MirrorPlugin()
  const alice2 = new MirrorPlugin()
  alice1.linkTo(alice2)
  alice2.linkTo(alice1)

  const bob1 = new MirrorPlugin()
  const bob2 = new MirrorPlugin()
  bob1.linkTo(bob2)
  bob2.linkTo(bob1)

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

  // TODO What should I check the delivered amount against?

  const serverConnection = await connectionPromise
  expect(new BigNumber(serverConnection.totalReceived)).toEqual(
    receipt.amountDelivered.shiftedBy(9)
  )
  expect(receipt.amountSent).toEqual(amountToSend)
  expect(receipt.amountInFlight).toEqual(new BigNumber(0))

  // Interval in `deduplicate` middleware continues running unless the plugins are manually removed
  await app.removePlugin('alice', alice2)
  await app.removePlugin('bob', bob1)

  await app.shutdown()
  await streamServer.close()
}, 10000)

test('delivers fixed destination amount with max packet amount', async () => {
  const alice1 = new MirrorPlugin()
  const alice2 = new MirrorPlugin()
  alice1.linkTo(alice2)
  alice2.linkTo(alice1)

  const bob1 = new MirrorPlugin()
  const bob2 = new MirrorPlugin()
  bob1.linkTo(bob2)
  bob2.linkTo(bob1)

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

  // TODO Hardcode this... non determinism is not great
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

  // Interval in `deduplicate` middleware continues running unless the plugins are manually removed
  await app.removePlugin('alice', alice2)
  await app.removePlugin('bob', bob1)

  await app.shutdown()
  await streamServer.close()
}, 10000)

test('ends payment if receiver closes the stream', async () => {
  const alice1 = new MirrorPlugin()
  const alice2 = new MirrorPlugin()
  alice1.linkTo(alice2)
  alice2.linkTo(alice1)

  const bob1 = new MirrorPlugin()
  const bob2 = new MirrorPlugin()
  bob1.linkTo(bob2)
  bob2.linkTo(bob1)

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
        if (stream.totalReceived === '20') {
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

  expect(receipt.amountSent).toEqual(new BigNumber(0.2)) // Only $0.20 was received
  expect(receipt.amountDelivered).toEqual(new BigNumber(0.2)) // Only $0.20 was received
  expect(receipt.amountInFlight).toEqual(new BigNumber(0))

  // Interval in `deduplicate` middleware continues running unless the plugins are manually removed
  await app.removePlugin('alice', alice2)
  await app.removePlugin('bob', bob1)

  await app.shutdown()
  await streamServer.close()
})

test('ends payment if receiver closes the connection', async () => {
  const alice1 = new MirrorPlugin()
  const alice2 = new MirrorPlugin()
  alice1.linkTo(alice2)
  alice2.linkTo(alice1)

  const bob1 = new MirrorPlugin()
  const bob2 = new MirrorPlugin()
  bob1.linkTo(bob2)
  bob2.linkTo(bob1)

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

  expect(receipt.amountSent.isGreaterThan(1))
  expect(receipt.amountSent.isLessThan(100))
  expect(receipt.amountSent).toEqual(receipt.amountDelivered)
  expect(receipt.amountInFlight).toEqual(new BigNumber(0))

  // Interval in `deduplicate` middleware continues running unless the plugins are manually removed
  await app.removePlugin('alice', alice2)
  await app.removePlugin('bob', bob1)

  await app.shutdown()
  // await streamServer.close()
}, 10000)
