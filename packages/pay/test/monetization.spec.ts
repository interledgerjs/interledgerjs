import { monetize } from '../src/web-monetization'
import { MirrorPlugin } from './helpers/plugin'
import nock from 'nock'
import { StreamServer } from '@interledger/stream-receiver'
import { randomBytes } from 'ilp-protocol-stream/dist/src/crypto'
import { createApp } from 'ilp-connector'
import { deserializeIlpPrepare, isIlpReply, serializeIlpReply } from 'ilp-packet'
import { sleep } from '../src/utils'
import { describe, it } from '@jest/globals'
import { performance } from 'perf_hooks'

describe('congestion control', () => {
  it('discovers available bandwidth', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const server = new StreamServer({
      serverAddress: 'private.larry.receiver',
      serverSecret: randomBytes(32),
    })

    receiverPlugin2.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)
      const moneyOrReply = server.createReply(prepare)
      return serializeIlpReply(isIlpReply(moneyOrReply) ? moneyOrReply : moneyOrReply.accept())
    })
    await receiverPlugin2.connect()

    nock('https://alice.mywallet.com')
      .get('/.well-known/pay')
      .matchHeader('Accept', (v) => v.includes('application/spsp4+json'))
      .reply(200, () => {
        const credentials = server.generateCredentials({
          asset: {
            code: 'ABC',
            scale: 0,
          },
        })

        return {
          shared_secret: credentials.sharedSecret.toString('base64'),
          destination_account: credentials.ilpAddress,
        }
      })

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      defaultRoute: 'receiver',
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 0,
          plugin: senderPlugin2,
          // maxPacketAmount: '100000', // TODO so max packet amount is only discovered via probe...
          throughput: {
            refillPeriod: 1000,
            incomingAmount: '58200',
          },
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

    const stream1 = await monetize({
      paymentPointer: '$alice.mywallet.com/',
      plugin: senderPlugin1,
      initialPacketAmount: 10_000, // TODO What should this be?
    })
    stream1.start()
    const startTime = performance.now()

    let stream1Total = 0
    stream1.on('progress', ({ amount }) => {
      stream1Total += +amount
    })

    await sleep(10_000)

    const endTime = performance.now()
    await stream1.stop()

    // TODO Compare this to an estimated 300,000 units of available bandwidth
    console.log('Utilized bandwidth:', (stream1Total / (endTime - startTime)) * 1000)

    await app.shutdown()
  }, 30_000)

  it.only('competes fairly', async () => {
    const [senderPlugin1, senderPlugin2] = MirrorPlugin.createPair()
    const [receiverPlugin1, receiverPlugin2] = MirrorPlugin.createPair()

    const server = new StreamServer({
      serverAddress: 'private.larry.receiver',
      serverSecret: randomBytes(32),
    })

    receiverPlugin2.registerDataHandler(async (data) => {
      const prepare = deserializeIlpPrepare(data)
      const moneyOrReply = server.createReply(prepare)
      return serializeIlpReply(isIlpReply(moneyOrReply) ? moneyOrReply : moneyOrReply.accept())
    })
    await receiverPlugin2.connect()

    nock('https://alice.mywallet.com')
      .get('/.well-known/pay')
      .matchHeader('Accept', (v) => v.includes('application/spsp4+json'))
      .twice()
      .reply(200, () => {
        const credentials = server.generateCredentials({
          asset: {
            code: 'ABC',
            scale: 0,
          },
        })

        return {
          shared_secret: credentials.sharedSecret.toString('base64'),
          destination_account: credentials.ilpAddress,
        }
      })

    const app = createApp({
      ilpAddress: 'private.larry',
      backend: 'one-to-one',
      spread: 0,
      defaultRoute: 'receiver',
      accounts: {
        sender: {
          relation: 'child',
          assetCode: 'ABC',
          assetScale: 0,
          plugin: senderPlugin2,
          throughput: {
            refillPeriod: 1000,
            incomingAmount: '58200', // Limit 3,000 units / second
          },
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

    const stream1 = await monetize({
      paymentPointer: '$alice.mywallet.com/',
      plugin: senderPlugin1,
      initialPacketAmount: 8_000, // TODO What should this be?
    })
    stream1.start()

    await sleep(2_000)

    const stream2 = await monetize({
      paymentPointer: '$alice.mywallet.com/',
      plugin: senderPlugin1,
      initialPacketAmount: 8_000, // TODO What should this be?
    })
    stream2.start()

    let stream1Total = 0
    stream1.on('progress', ({ amount }) => {
      stream1Total += +amount
    })

    let stream2Total = 0
    stream2.on('progress', ({ amount }) => {
      stream2Total += +amount
    })

    await sleep(20_000)

    await Promise.all([stream1.stop(), stream2.stop()])

    // TODO Compare this to an estimated 300,000 units of available bandwidth
    console.log(stream1Total)
    console.log(stream2Total)

    // TODO Do something here?

    await app.shutdown()
  }, 30_000)
})
