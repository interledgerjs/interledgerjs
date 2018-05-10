import 'mocha'
import { Connection } from '../src/connection'
import { DataAndMoneyStream } from '../src/stream'
import { createConnection, Server, createServer } from '../src/index'
import MockPlugin from './mocks/plugin'
import * as sinon from 'sinon'
import * as Chai from 'chai'
const IlpPluginBtp = require('ilp-plugin-btp')
import * as chaiAsPromised from 'chai-as-promised'
Chai.use(chaiAsPromised)
const assert = Object.assign(Chai.assert, sinon.assert)
require('source-map-support').install()

describe('Server', function () {
  beforeEach(function () {
    this.clientPlugin = new MockPlugin(0.5)
    this.serverPlugin = this.clientPlugin.mirror
  })

  describe('constructor', function () {
    it('should get a plugin from the environment (and default to using ilp-plugin-btp) if none is supplied', function () {
      const server = new Server({
        serverSecret: Buffer.alloc(32)
      })
      assert.instanceOf(server['plugin'], IlpPluginBtp)
    })

    it('should generate a random serverSecret if one is not supplied', function () {
      const server = new Server({
        plugin: this.serverPlugin
      })
      assert(Buffer.isBuffer(server['serverSecret']))
      assert.lengthOf(server['serverSecret'], 32)
    })

    it('should work if no options are passed in', function () {
      const server = new Server()
      assert.instanceOf(server['plugin'], IlpPluginBtp)
      assert(Buffer.isBuffer(server['serverSecret']))
    })
  })

  describe('generateAddressAndSecret', function () {
    beforeEach(async function () {
      this.server = new Server({
        serverSecret: Buffer.alloc(32),
        plugin: this.serverPlugin
      })
    })

    it('should throw an error if the server is not connected', function () {
      const server = new Server({
        serverSecret: Buffer.alloc(32),
        plugin: this.serverPlugin
      })

      assert.throws(() => server.generateAddressAndSecret(), 'Server must be connected to generate address and secret')
    })

    it('should return a destinationAccount and sharedSecret', async function () {
      await this.server.listen()

      const result = this.server.generateAddressAndSecret()
      assert(Buffer.isBuffer(result.sharedSecret))
      assert.lengthOf(result.sharedSecret, 32)
      assert.typeOf(result.destinationAccount, 'string')
    })

    it('should accept connections created without connectionTags', async function () {
      await this.server.listen()
      const { destinationAccount, sharedSecret } = this.server.generateAddressAndSecret()
      const connectionPromise = this.server.acceptConnection()

      const clientConn = await createConnection({
        plugin: this.clientPlugin,
        destinationAccount,
        sharedSecret
      })

      const connection = await connectionPromise
    })

    it('should accept a connectionTag and attach it to the incoming connection', async function () {
      await this.server.listen()
      const connectionTag = 'hello-there_123'
      const { destinationAccount, sharedSecret } = this.server.generateAddressAndSecret(connectionTag)
      const connectionPromise = this.server.acceptConnection()

      const clientConn = await createConnection({
        plugin: this.clientPlugin,
        destinationAccount,
        sharedSecret
      })

      const connection = await connectionPromise
      assert.equal(connection.connectionTag, connectionTag)
    })

    it('should reject the connection if the connectionTag is modified', async function () {
      await this.server.listen()
      const connectionName = 'hello-there_123'
      const { destinationAccount, sharedSecret } = this.server.generateAddressAndSecret(connectionName)

      const spy = sinon.spy()
      this.server.on('connection', spy)

      const realSendData = this.clientPlugin.sendData.bind(this.clientPlugin)
      const responses: Buffer[] = []
      this.clientPlugin.sendData = async (data: Buffer): Promise<Buffer> => {
        const response = await realSendData(data)
        responses.push(response)
        return response
      }

      await assert.isRejected(createConnection({
        plugin: this.clientPlugin,
        destinationAccount: destinationAccount + '456',
        sharedSecret
      }), 'Error connecting: Unexpected error while sending packet. Code: F02, message: ')

      assert.notCalled(spy)
    })

    it('should throw an error if the connectionTag includes characters that cannot go into an ILP address', async function () {
      await this.server.listen()
      assert.throws(() => this.server.generateAddressAndSecret('invalid\n'), 'connectionTag can only include ASCII characters a-z, A-Z, 0-9, "_", and "-"')
    })
  })

  describe('"connection" event', function () {
    beforeEach(async function () {
      this.server = new Server({
        serverSecret: Buffer.alloc(32),
        plugin: this.serverPlugin
      })
      await this.server.listen()
    })

    it('should not reject the packet if there is an error in the connection event handler', async function () {
      this.server.on('connection', () => {
        throw new Error('blah')
      })

      await createConnection({
        ...this.server.generateAddressAndSecret(),
        plugin: this.clientPlugin
      })
    })
  })

  describe('Closed Connections', function () {
    beforeEach(async function () {
      this.server = new Server({
        serverSecret: Buffer.alloc(32),
        plugin: this.serverPlugin
      })
      await this.server.listen()

      const { destinationAccount, sharedSecret } = this.server.generateAddressAndSecret()
      this.destinationAccount = destinationAccount
      this.sharedSecret = sharedSecret

      const serverConnPromise = this.server.acceptConnection()
      this.clientConn = await createConnection({
        plugin: this.clientPlugin,
        destinationAccount,
        sharedSecret
      })
      this.serverConn = await serverConnPromise
    })

    it('should reject packets for connections that have already been closed', async function () {
      await this.serverConn.destroy()

      await assert.isRejected(createConnection({
        plugin: this.clientPlugin,
        sharedSecret: this.sharedSecret,
        destinationAccount: this.destinationAccount
      }), 'Error connecting: Unexpected error while sending packet. Code: F02, message:')
    })

    it('should remove the record of closed connections', async function () {
      assert.equal(Object.keys(this.server['connections']).length, 1)
      await this.serverConn.destroy()
      assert.equal(Object.keys(this.server['connections']).length, 0)
    })
  })
})

describe('createServer', function () {
  beforeEach(function () {
    this.clientPlugin = new MockPlugin(0.5)
    this.serverPlugin = this.clientPlugin.mirror
  })

  it('should return a server that is listening', async function () {
    const spy = sinon.spy(this.serverPlugin, 'connect')
    const server = await createServer({
      serverSecret: Buffer.alloc(32),
      plugin: this.serverPlugin
    })
    assert.instanceOf(server, Server)
    assert.called(spy)
  })
})