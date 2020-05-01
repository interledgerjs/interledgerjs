import { createApp } from '@kincaidoneil/ilp-connector'
import RateBackend from '@kincaidoneil/ilp-connector/dist/services/rate-backend'
import test from 'ava'
import BigNumber from 'bignumber.js'
import { Connection, createServer, DataAndMoneyStream } from 'ilp-protocol-stream'
import Long from 'long'
import reduct from 'reduct'
import { CustomBackend } from './rate-backend'
import { MirrorPlugin } from './plugin'
import { fetchCoinCapRates } from '../src/rates/coincap'
import { getRate } from '../src/rates'
import { quote } from '../src'

test('completes source amount payment with max packet amount', async t => {
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
        prices
      },
      accounts: {
        alice: {
          relation: 'child',
          plugin: alice2,
          assetCode: 'USD',
          assetScale: 6,
          maxPacketAmount: '5454'
        },
        bob: {
          relation: 'child',
          plugin: bob1,
          assetCode: 'XRP',
          assetScale: 9
        }
      }
    },
    deps
  )
  await app.listen()

  const streamServer = await createServer({
    plugin: bob2
  })

  const connectionPromise = streamServer.acceptConnection()
  streamServer.on('connection', (connection: Connection) => {
    connection.on('stream', (stream: DataAndMoneyStream) => {
      stream.setReceiveMax(Long.MAX_UNSIGNED_VALUE)
    })
  })

  const {
    sharedSecret,
    destinationAccount: destinationAddress
  } = streamServer.generateAddressAndSecret()

  const amountToSend = new BigNumber(1.00427)
  const { pay, ...quoteDetails } = await quote({
    amountToSend,
    destinationAddress,
    sharedSecret,
    plugin: alice1,
    slippage: 0.015
  })

  t.is(quoteDetails.sourceAccount.assetCode, 'USD')
  t.is(quoteDetails.sourceAccount.assetScale, 6)
  t.is(quoteDetails.sourceAccount.ilpAddress, 'test.larry.alice')
  t.is(quoteDetails.destinationAccount.assetCode, 'XRP')
  t.is(quoteDetails.destinationAccount.assetScale, 9)
  t.is(quoteDetails.destinationAccount.ilpAddress, destinationAddress)
  t.deepEqual(quoteDetails.maxSourceAmount, amountToSend)

  const receipt = await pay()

  // TODO What should I check the delivered amount against?

  const serverConnection = await connectionPromise
  t.deepEqual(new BigNumber(serverConnection.totalReceived), receipt.amountDelivered.shiftedBy(9))
  t.deepEqual(receipt.amountSent, amountToSend)
  t.deepEqual(receipt.amountInFlight, new BigNumber(0))

  // Interval in `deduplicate` middleware continues running unless the plugins are manually removed
  await app.removePlugin('alice', alice2)
  await app.removePlugin('bob', bob1)

  await app.shutdown()
  await streamServer.close()
})

test('delivers fixed destination amount with max packet amount', async t => {
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
        prices
      },
      accounts: {
        alice: {
          relation: 'child',
          plugin: alice2,
          assetCode: 'ETH',
          assetScale: 9,
          maxPacketAmount: '899898'
        },
        bob: {
          relation: 'child',
          plugin: bob1,
          assetCode: 'BTC',
          assetScale: 8
        }
      }
    },
    deps
  )
  await app.listen()

  const streamServer = await createServer({
    plugin: bob2
  })

  const amountToDeliver = getRate('USD', 0, 'BTC', 0, prices)
    ?.times(10)
    .decimalPlaces(8)
  if (!amountToDeliver) {
    return t.fail()
  }

  const connectionPromise = streamServer.acceptConnection()
  streamServer.on('connection', (connection: Connection) => {
    connection.on('stream', (stream: DataAndMoneyStream) => {
      stream.setReceiveMax(amountToDeliver.shiftedBy(8).toString())
    })
  })

  const {
    sharedSecret,
    destinationAccount: destinationAddress
  } = streamServer.generateAddressAndSecret()

  const { pay, ...quoteDetails } = await quote({
    amountToDeliver,
    destinationAssetCode: 'BTC',
    destinationAssetScale: 8,
    destinationAddress,
    sharedSecret,
    slippage: 0.015,
    plugin: alice1
  })
  const receipt = await pay()

  const serverConnection = await connectionPromise
  t.deepEqual(new BigNumber(serverConnection.totalReceived), amountToDeliver.shiftedBy(8))
  t.deepEqual(receipt.amountDelivered, amountToDeliver)
  t.deepEqual(receipt.amountInFlight, new BigNumber(0))
  t.true(receipt.amountSent.isLessThanOrEqualTo(quoteDetails.maxSourceAmount))

  // Interval in `deduplicate` middleware continues running unless the plugins are manually removed
  await app.removePlugin('alice', alice2)
  await app.removePlugin('bob', bob1)

  await app.shutdown()
  await streamServer.close()
})

test('ends payment if receiver closes the stream', async t => {
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
        maxPacketAmount: '10' // $0.10
      },
      bob: {
        relation: 'child',
        plugin: bob1,
        assetCode: 'USD',
        assetScale: 2
      }
    }
  })
  await app.listen()

  const streamServer = await createServer({
    plugin: bob2
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
    destinationAccount: destinationAddress
  } = streamServer.generateAddressAndSecret()

  // Since we're sending $100,000, test will fail due to timeout
  // if the connection isn't closed quickly

  const { pay } = await quote({
    amountToSend: new BigNumber(10000000),
    destinationAddress,
    sharedSecret,
    slippage: 0,
    plugin: alice1
  })
  const receipt = await pay()

  t.deepEqual(receipt.amountSent, new BigNumber(0.2)) // Only $0.20 was received
  t.deepEqual(receipt.amountDelivered, new BigNumber(0.2)) // Only $0.20 was received
  t.deepEqual(receipt.amountInFlight, new BigNumber(0))

  // Interval in `deduplicate` middleware continues running unless the plugins are manually removed
  await app.removePlugin('alice', alice2)
  await app.removePlugin('bob', bob1)

  await app.shutdown()
  await streamServer.close()
})

test('ends payment if receiver closes the connection', async t => {
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
        maxPacketAmount: '1'
      },
      bob: {
        relation: 'child',
        plugin: bob1,
        assetCode: 'ABC',
        assetScale: 0
      }
    }
  })
  await app.listen()

  const streamServer = await createServer({
    plugin: bob2
  })

  const connectionPromise = streamServer.acceptConnection()
  streamServer.on('connection', (connection: Connection) => {
    connection.on('stream', (stream: DataAndMoneyStream) => {
      stream.setReceiveMax(Long.MAX_UNSIGNED_VALUE)
    })
  })

  const {
    sharedSecret,
    destinationAccount: destinationAddress
  } = streamServer.generateAddressAndSecret()

  // Since we're sending such a large payment, test will fail due to timeout
  // if the payment doesn't end promptly

  const { pay } = await quote({
    amountToSend: new BigNumber(100000000000),
    destinationAddress,
    sharedSecret,
    slippage: 0,
    plugin: alice1
  })

  // End the connection after 1 second
  const serverConnection = await connectionPromise
  setTimeout(() => serverConnection.end(), 1000)

  const receipt = await pay()

  t.true(receipt.amountSent.isGreaterThan(1))
  t.true(receipt.amountSent.isLessThan(100))
  t.deepEqual(receipt.amountSent, receipt.amountDelivered)
  t.deepEqual(receipt.amountInFlight, new BigNumber(0))

  // Interval in `deduplicate` middleware continues running unless the plugins are manually removed
  await app.removePlugin('alice', alice2)
  await app.removePlugin('bob', bob1)

  await app.shutdown()
  await streamServer.close()
})
