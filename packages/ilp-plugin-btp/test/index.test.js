'use strict'

const assert = require('assert')
const btp = require('btp-packet')
const Plugin = require('..')
const mockSocket = require('./helpers/mockSocket')

describe('BtpPlugin', function () {
  beforeEach(async function () {
    this.clientOpts = {
      server: 'btp+ws://bob:secret@localhost:9000',
      reconnectInterval: 100,
      responseTimeout: 100
    }
    this.serverOpts = {
      listener: {
        port: 9000,
        secret: 'secret'
      },
      responseTimeout: 100
    }
    this.authData = [
      { protocolName: 'auth', contentType: btp.MIME_APPLICATION_OCTET_STREAM, data: Buffer.from('') },
      { protocolName: 'auth_username', contentType: btp.MIME_TEXT_PLAIN_UTF8, data: Buffer.from('bob') },
      { protocolName: 'auth_token', contentType: btp.MIME_TEXT_PLAIN_UTF8, data: Buffer.from('secret') }
    ]
    this.ilpReqData = [
      { protocolName: 'ilp', contentType: btp.MIME_APPLICATION_OCTET_STREAM, data: Buffer.from('ilp request') }
    ]
    this.ilpResData = [
      { protocolName: 'ilp', contentType: btp.MIME_APPLICATION_OCTET_STREAM, data: Buffer.from('ilp response') }
    ]
    this.errorData = {
      code: 'F00',
      name: 'NotAcceptedError',
      data: 'error data',
      triggeredAt: (new Date).toISOString(),
      protocolData: []
    }
    this.authReqPacket = { type: btp.TYPE_MESSAGE, requestId: 123, data: {protocolData: this.authData} }
    this.authResPacket = { type: btp.TYPE_RESPONSE, requestId: 123, data: {protocolData: []} }
    this.ilpReqPacket = { type: btp.TYPE_MESSAGE, requestId: 456, data: {protocolData: this.ilpReqData} }
    this.ilpResPacket = { type: btp.TYPE_RESPONSE, requestId: 456, data: {protocolData: this.ilpResData} }
    this.errorPacket = { type: btp.TYPE_ERROR, requestId: 456, data: this.errorData }

    this.setupServer = async () => {
      this.ws = new mockSocket.IncomingSocket()
      this.plugin = new Plugin(this.serverOpts, {WebSocketServer: mockSocket.Server})

      const connect = this.plugin.connect()
      this.plugin._wss.emit('connection', this.ws)
      this.ws.emit('message', btp.serialize(this.authReqPacket))
      await connect
    }
  })

  describe('connect real WebSocket', function () {
    beforeEach(async function () {
      this.server = new Plugin(this.clientOpts)
      this.client = new Plugin(this.serverOpts)
    })

    afterEach(async function () {
      await this.client.disconnect()
      await this.server.disconnect()
    })

    it('connects the client and server', async function () {
      await Promise.all([
        this.server.connect(),
        this.client.connect()
      ])
      assert.strictEqual(this.server.isConnected(), true)
      assert.strictEqual(this.client.isConnected(), true)

      this.server.registerDataHandler((ilp) => {
        assert.deepEqual(ilp, Buffer.from('foo'))
        return Buffer.from('bar')
      })

      const response = await this.client.sendData(Buffer.from('foo'))
      assert.deepEqual(response, Buffer.from('bar'))
    })
  })

  describe('connect (server)', function () {
    beforeEach(async function () {
      this.ws = new mockSocket.IncomingSocket()
      this.server = new Plugin(this.serverOpts, {WebSocketServer: mockSocket.Server})
    })

    it('succeeds if the auth is correct', async function () {
      const connect = this.server.connect()
      this.server._wss.emit('connection', this.ws)
      this.ws.emit('message', btp.serialize(this.authReqPacket))
      await connect
      assert.strictEqual(this.server.isConnected(), true)
      assert.deepEqual(this.ws.responses, [{
        type: btp.TYPE_RESPONSE,
        requestId: 123,
        data: {protocolData: []}
      }])
    })

    it('reconnects when the connection is lost', async function () {
      const connect = this.server.connect()
      this.server._wss.emit('connection', this.ws)
      this.ws.emit('message', btp.serialize(this.authReqPacket))
      await connect
      assert.equal(this.server.isConnected(), true)
      this.ws.emit('close')
      assert.equal(this.server.isConnected(), false)
      this.server._wss.emit('connection', this.ws)
      this.ws.emit('message', btp.serialize(this.authReqPacket))
      assert.equal(this.server.isConnected(), true)
    })

    it('emits "connect"/"disconnect" as connections are gained/lost', async function () {
      this.server.connect()
      this.server._wss.emit('connection', this.ws)
      setImmediate(() => this.ws.emit('message', btp.serialize(this.authReqPacket)))
      await new Promise((resolve) => this.server.once('connect', resolve))
      setImmediate(() => this.ws.emit('error', new Error('fail')))
      await new Promise((resolve) => this.server.once('disconnect', resolve))
      this.server._wss.emit('connection', this.ws)
      setImmediate(() => this.ws.emit('message', btp.serialize(this.authReqPacket)))
      await new Promise((resolve) => this.server.once('connect', resolve))
      assert.equal(this.server.isConnected(), true)
    })

    ;[
      {
        label: 'throws if the primary protocol is not "auth"',
        authData: [
          { protocolName: 'auth_username', contentType: btp.MIME_TEXT_PLAIN_UTF8, data: Buffer.from('bob') },
          { protocolName: 'auth', contentType: btp.MIME_APPLICATION_OCTET_STREAM, data: Buffer.from('') },
          { protocolName: 'auth_token', contentType: btp.MIME_TEXT_PLAIN_UTF8, data: Buffer.from('INVALID') }
        ],
        error: 'First subprotocol must be auth'
      },
      {
        label: 'throws if the auth token is missing',
        authData: [
          { protocolName: 'auth', contentType: btp.MIME_APPLICATION_OCTET_STREAM, data: Buffer.from('') },
          { protocolName: 'auth_username', contentType: btp.MIME_TEXT_PLAIN_UTF8, data: Buffer.from('bob') }
        ],
        error: 'auth_token subprotocol is required'
      },
      {
        label: 'throws if the auth token is incorrect',
        authData: [
          { protocolName: 'auth', contentType: btp.MIME_APPLICATION_OCTET_STREAM, data: Buffer.from('') },
          { protocolName: 'auth_username', contentType: btp.MIME_TEXT_PLAIN_UTF8, data: Buffer.from('bob') },
          { protocolName: 'auth_token', contentType: btp.MIME_TEXT_PLAIN_UTF8, data: Buffer.from('INVALID') }
        ],
        error: 'invalid auth_token'
      }
    ].forEach(function ({label, authData, error}) {
      it(label, async function () {
        const connect = this.server.connect()
        this.server._wss.emit('connection', this.ws)
        this.ws.emit('message', btp.serialize({
          type: btp.TYPE_MESSAGE,
          requestId: 123,
          data: {protocolData: authData}
        }))

        assert.strictEqual(this.server.isConnected(), false)
        assert.equal(this.ws.responses.length, 1)
        const res = this.ws.responses[0]
        assert.deepEqual(res, {
          type: btp.TYPE_ERROR,
          requestId: 123,
          data: Object.assign(this.errorData, { data: error, triggeredAt: res.data.triggeredAt })
        })
        assert.ok(this.ws.closed)
      })
    })
  })

  describe('connect (client)', function () {
    it('retries if first connect fails', async function () {
      const client = new Plugin(this.clientOpts, {WebSocket: mockSocket.makeClient([
        { error: new Error('connection fail') },
        {
          req: {type: btp.TYPE_MESSAGE, data: {protocolData: this.authData}},
          res: {type: btp.TYPE_RESPONSE, data: {protocolData: []}}
        }
      ])})

      const pConnect = client.connect()
      await new Promise((resolve) => setTimeout(resolve, 10))
      await pConnect
      assert.strictEqual(client.isConnected(), true)
    })
  })

  describe('disconnect', function () {
    it('emits "disconnect"', async function () {
      const client = new Plugin(this.clientOpts, {WebSocket: mockSocket.makeClient([
        {
          req: {type: btp.TYPE_MESSAGE, data: {protocolData: this.authData}},
          res: {type: btp.TYPE_RESPONSE, data: {protocolData: []}}
        }
      ])})
      await client.connect()
      let disconnected
      client.once('disconnect', () => disconnected = true)
      await client.disconnect()
      assert.ok(disconnected)
    })
  })

  describe('registerDataHandler', function () {
    beforeEach(async function () { await this.setupServer() })

    it('registers a data handler', async function () {
      this.plugin.registerDataHandler((packet) => {
        assert.deepEqual(packet, this.ilpReqData[0].data)
        return this.ilpResData[0].data
      })
      await this.plugin._handleIncomingBtpPacket('', {
        type: btp.TYPE_MESSAGE,
        requestId: 456,
        data: { protocolData: this.ilpReqData }
      })
      assert.deepEqual(this.ws.responses, [this.authResPacket, this.ilpResPacket])
    })

    it('throws if the plugin already has a data handler', async function () {
      this.plugin.registerDataHandler((packet) => { })
      assert.throws(() => {
        this.plugin.registerDataHandler((packet) => { })
      })
    })

    it('throws if a non-function is registered', async function () {
      assert.throws(() => {
        this.plugin.registerDataHandler('what')
      })
    })
  })

  describe('deregisterDataHandler', function () {
    beforeEach(async function () { await this.setupServer() })

    it('deregisters a data handler', async function () {
      this.plugin.registerDataHandler((packet) => { })
      this.plugin.deregisterDataHandler()
      this.plugin.registerDataHandler((packet) => { })
    })
  })

  describe('_call', function () {
    beforeEach(async function () { await this.setupServer() })

    it('resolves the response', async function () {
      setImmediate(() => {
        this.plugin._handleIncomingBtpPacket('', this.ilpResPacket)
      })
      const res = await this.plugin._call('', this.ilpReqPacket)
      assert.deepEqual(res, {protocolData: this.ilpResData})
    })

    it('rejects an error', async function () {
      setImmediate(() => {
        this.plugin._handleIncomingBtpPacket('', this.errorPacket)
      })
      await this.plugin._call('', this.ilpReqPacket).then(() => {
        assert(false)
      }).catch((err) => {
        assert.equal(err.message, JSON.stringify(this.errorData))
      })
    })

    it('times out', async function () {
      try {
        await this.plugin._call('', this.ilpReqPacket)
      } catch (err) {
        assert.equal(err.message, '456 timed out')
        return
      }
      assert(false)
    })
  })
})
