const BtpPlugin = require('../..')
const IlpPacket = require('ilp-packet')
const server = new BtpPlugin({
  listener: {
    port: 9000,
    secret: 'secret'
  }
})
const client = new BtpPlugin({
  server: 'btp+ws://:secret@localhost:9000'
})

async function run () {
  await Promise.all([
    server.connect(),
    client.connect()
  ])

  server.registerDataHandler((ilp) => {
    console.log('server got:', IlpPacket.deserializeIlpPacket(ilp))
    return IlpPacket.serializeIlpFulfill({
      fulfillment: Buffer.alloc(32),
      data: Buffer.from('hello world again')
    })
  })

  const response = await client.sendData(IlpPacket.serializeIlpPrepare({
    amount: '10',
    expiresAt: new Date(),
    executionCondition: Buffer.alloc(32),
    destination: 'peer.example',
    data: Buffer.from('hello world')
  }))

  console.log('client got:', IlpPacket.deserializeIlpPacket(response))

  await server.sendMoney(10)
  await client.sendMoney(10)
  console.log('sent money (no-op)')

  await client.disconnect()
  await server.disconnect()
  process.exit(0)
}

run()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
