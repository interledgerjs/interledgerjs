// This script runs a HTTP & stream server (over mini-accounts and btp) and serves
// a page that connects to the server via stream and constantly sends money.

'use strict'

const fs = require('fs')
const http = require('http')
const path = require('path')
const PluginMiniAccounts = require('ilp-plugin-mini-accounts')
const { createServer, Connection } = require('../')

const STREAM_PORT = 9001
const HTTP_PORT = 9002
const BUNDLE_FILE = path.resolve(__dirname, '../dist/test/browser/bundle.js')

runStreamServer()
  .then((info) => {
    const httpServer = http.createServer(makeRequestHandler({
      streamPort: STREAM_PORT,
      destinationAccount: info.destinationAccount,
      sharedSecret: info.sharedSecret.toString('base64')
    }))
    httpServer.listen(HTTP_PORT, '127.0.0.1')
    console.log(`http://127.0.0.1:${HTTP_PORT}`)
  })
  .catch((err) => {
    console.error(err.stack)
    process.exit(1)
  })

async function runStreamServer () {
  const serverPlugin = new PluginMiniAccounts({
    port: STREAM_PORT,
    allowedOrigins: ['.*'],
    debugHostIldcpInfo: {
      clientAddress: 'test.example',
      assetScale: 9,
      assetCode: '___'
    }
  })
  const server = await createServer({ plugin: serverPlugin })
  server.on('connection', (connection) => {
    console.log('new connection')
    connection.on('stream', (stream) => {
      console.log('new stream')
      stream.setReceiveMax(10000)
      stream.on('money', (amount) => { process.stdout.write(amount + ',') })
    })
  })
  return server.generateAddressAndSecret()
}

function makeRequestHandler (streamInfo) {
  return function (req, res) {
    switch (req.url) {
    case '/':
      res.setHeader('Content-Type', 'text/html')
      res.write(makeHTML(streamInfo))
      break
    case '/bundle.js':
      res.setHeader('Content-Type', 'text/javascript')
      res.write(fs.readFileSync(BUNDLE_FILE))
      break
    default:
      res.statusCode = 404
    }
    res.end()
  }
}

function makeHTML (info) {
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <title>ilp-protocol-stream test page</title>
      <script type="text/javascript" src="/bundle.js"></script>
      <script type="text/javascript">
        const info = ${JSON.stringify(info)};
        const run = ${clientCode.toString()};
        run(info);
      </script>
    </head>
    <body>ilp-protocol-stream test page</body>
  </html>`
}

async function clientCode (info) {
  const BATCH_SIZE = 1000
  let totalAmount = 0

  const client = await window.makeStreamClient({
    server: `btp+ws://127.0.0.1:${info.streamPort}`,
    btpToken: 'secret'
  }, info)
  const stream = await client.createStream()

  sendBatch()

  function sendBatch () {
    _sendBatch()
      .then((elapsed) => {
        console.log('elapsed:', elapsed, 'ms')
        setTimeout(sendBatch, 100)
      })
      .catch((err) => console.error('sendTotal error:', err.stack))
  }

  async function _sendBatch () {
    const start = performance.now()
    for (let i = 0; i < BATCH_SIZE; i++) {
      await stream.sendTotal(++totalAmount)
    }
    return (performance.now() - start) / BATCH_SIZE
  }
}
