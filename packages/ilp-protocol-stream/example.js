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

  server.on('connection', (connection) => {
    console.log('server got connection')
    connection.on('stream', (stream) => {
      console.log('server got a new stream')
      stream.setReceiveMax(10000)
      stream.on('money', (amount) => {
        console.log(`got incoming payment for: ${amount}`)
      })
      stream.on('data', (chunk) => {
        console.log(`stream got data: ${chunk.toString('utf8')}`)
      })
    })
  })

  const { destinationAccount, sharedSecret } = server.generateAddressAndSecret()
  const clientConn = await IlpStream.createConnection({
    plugin: clientPlugin,
    destinationAccount,
    sharedSecret
  })

  const stream = clientConn.createStream()
  console.log('sending data to server')
  stream.write('hello there!')

  console.log('sending money')
  await stream.sendTotal(100)
  console.log('sent 100 units')
}

run().catch((err) => console.log(err))
