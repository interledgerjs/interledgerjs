import 'mocha'
import { Connection } from '../src/connection'
import * as index from '../src/index'
import MockPlugin from './mocks/plugin'
import { MoneyStream } from '../src/money-stream'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
Chai.use(chaiAsPromised)
const assert = Object.assign(Chai.assert, sinon.assert)

describe('Server', function () {
  beforeEach(async function () {
    this.clientPlugin = new MockPlugin(0.5)
    this.serverPlugin = this.clientPlugin.mirror
  })

  describe('generateAddressAndSecret', function () {
    it('should throw an error if the server is not connected', function () {
      const server = new index.Server({
        serverSecret: Buffer.alloc(32),
        plugin: this.serverPlugin
      })

      assert.throws(() => server.generateAddressAndSecret(), 'Server must be connected to generate address and secret')
    })

    it('should return a destinationAccount and sharedSecret', async function () {
      const server = new index.Server({
        serverSecret: Buffer.alloc(32),
        plugin: this.serverPlugin
      })
      await server.listen()

      const result = server.generateAddressAndSecret()
      assert(Buffer.isBuffer(result.sharedSecret))
      assert.lengthOf(result.sharedSecret, 32)
      assert.typeOf(result.destinationAccount, 'string')
    })
  })
})
