const IlpStream = require('.')
const crypto = require('crypto')
const Plugin = require('ilp-plugin-btp')

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
    console.log('got connection')
    connection.on('money_stream', (stream) => {
      console.log('got stream')
      stream.on('incoming', (amount) => {
        console.log(`got incoming payment for: ${amount}`)
      })
    })
  })

  const stream = clientConn.createMoneyStream()
  stream.send(10)
}

run().catch((err) => console.log(err))