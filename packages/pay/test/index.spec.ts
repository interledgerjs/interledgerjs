import { createApp } from '@kincaidoneil/ilp-connector'
import RateBackend from '@kincaidoneil/ilp-connector/dist/services/rate-backend'
import test from 'ava'
import BigNumber from 'bignumber.js'
import { Connection, createServer, DataAndMoneyStream } from 'ilp-protocol-stream'
import Long from 'long'
import reduct from 'reduct'
import { pay } from '../src/index'
import { CustomBackend } from './mocks/backend'
import { MirrorPlugin } from './mocks/plugin'
import { fetchCoinCapRates } from '../src/rates/coincap'
import { getRate, convert } from '../src/rates'

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

  const serverConnection = streamServer.acceptConnection()
  streamServer.on('connection', (connection: Connection) => {
    connection.on('stream', (stream: DataAndMoneyStream) => {
      stream.setReceiveMax(Long.MAX_UNSIGNED_VALUE)
    })
  })

  const {
    sharedSecret,
    destinationAccount: destinationAddress
  } = streamServer.generateAddressAndSecret()

  const rate = getRate('USD', 6, 'XRP', 9, prices).unsafelyUnwrap()
  const amountToSend = new BigNumber(1004270) // $1.00427

  const receipt = await pay({
    amountToSend,
    sourceAddress: 'test.larry.alice',
    sourceAssetCode: 'USD',
    sourceAssetScale: 6,
    destinationAssetCode: 'XRP',
    destinationAssetScale: 9,
    destinationAddress,
    sharedSecret,
    exchangeRate: new BigNumber(rate * 0.985), // 1.5% allowed slippage
    plugin: alice1
  })

  t.is((await serverConnection).totalReceived, receipt.amountDelivered.toFixed())
  t.deepEqual(receipt.amountSent, amountToSend)
  t.deepEqual(receipt.amountInFlight, new BigNumber(0))

  // Interval in `deduplicate` middleware continues running unless the plugins are manually removed
  await app.removePlugin('alice', alice2)
  await app.removePlugin('bob', bob1)

  await app.shutdown()

  // The server can never close since the source ILP address is never sent
  // To get the test to exit, the connection must be destroyed first
  await (await serverConnection).destroy()
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

  const rate = getRate('ETH', 9, 'BTC', 8, prices).unsafelyUnwrap()
  // prettier-ignore
  const maxSourceAmount = convert(11, 'USD', 'ETH', 9, prices, BigNumber.ROUND_CEIL).unsafelyUnwrap()
  // prettier-ignore
  const amountToDeliver = convert(10, 'USD', 'BTC', 8, prices, BigNumber.ROUND_CEIL).unsafelyUnwrap()

  const serverConnection = streamServer.acceptConnection()
  streamServer.on('connection', (connection: Connection) => {
    connection.on('stream', (stream: DataAndMoneyStream) => {
      stream.setReceiveMax(amountToDeliver.toString())
    })
  })

  const {
    sharedSecret,
    destinationAccount: destinationAddress
  } = streamServer.generateAddressAndSecret()

  const receipt = await pay({
    amountToSend: maxSourceAmount,
    amountToDeliver,
    sourceAddress: 'test.larry.alice',
    sourceAssetCode: 'ETH',
    sourceAssetScale: 9,
    destinationAssetCode: 'BTC',
    destinationAssetScale: 8,
    destinationAddress,
    sharedSecret,
    exchangeRate: new BigNumber(rate * 0.985), // 1.5% allowed spread
    plugin: alice1
  })

  t.is((await serverConnection).totalReceived, amountToDeliver.toFixed())
  t.deepEqual(receipt.amountDelivered, amountToDeliver)
  t.deepEqual(receipt.amountInFlight, new BigNumber(0))

  // Interval in `deduplicate` middleware continues running unless the plugins are manually removed
  await app.removePlugin('alice', alice2)
  await app.removePlugin('bob', bob1)

  await app.shutdown()

  // The server can never close since the source ILP address is never sent
  // To get the test to exit, the connection must be destroyed first
  await (await serverConnection).destroy()
  await streamServer.close()
})
