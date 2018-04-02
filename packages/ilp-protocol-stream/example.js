const IlpStream = require('.')
const crypto = require('crypto')
const Plugin = require('ilp-plugin-btp')

// Note this requires a local moneyd instance to work: https://github.com/interledgerjs/moneyd-xrp
const clientPlugin = new Plugin({ server: 'btp+ws://:client@localhost:7768'})
const serverPlugin = new Plugin({ server: 'btp+ws://:server@localhost:7768'})

const server = new IlpStream.Server({
  plugin: serverPlugin,
  serverSecret: crypto.randomBytes(32)
})


async function run () {
  await server.listen()

  const { destinationAccount, sharedSecret } = server.generateAddressAndSecret()
  const clientConn = await IlpStream.createConnection({
    plugin: clientPlugin,
    destinationAccount,
    sharedSecret
  })

  server.on('connection', (connection) => {
    console.log('server got connection')
    connection.on('money_stream', (moneyStream) => {
      moneyStream.setReceiveMax(10000)
      console.log('server got a new money stream')
      moneyStream.on('incoming', (amount) => {
        console.log(`got incoming payment for: ${amount}`)
      })
    })

    connection.on('data_stream', (dataStream) => {
      console.log('server got a new data stream')
      dataStream.on('data', (chunk) => {
        console.log(`stream got data: ${chunk.toString('utf8')}`)
      })
    })
  })

  const moneyStream = clientConn.createMoneyStream()
  await moneyStream.sendTotal(100)
  console.log('sent 100 units')

  const dataStream = clientConn.createDataStream()
  console.log('sending data to server')
  dataStream.write('hello there!')
}

run().catch((err) => console.log(err))