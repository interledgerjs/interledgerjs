import 'mocha'
import { Connection } from '../src/connection'
import { createConnection, Server } from '../src/index'
import MockPlugin from './mocks/plugin'
import { DataStream } from '../src/data-stream'
import { Duplex } from 'stream'
import * as IlpPacket from 'ilp-packet'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
Chai.use(chaiAsPromised)
const assert = Object.assign(Chai.assert, sinon.assert)

describe.only('DataStream', function () {
  beforeEach(async function () {
    this.clientPlugin = new MockPlugin(0.5)
    this.serverPlugin = this.clientPlugin.mirror

    this.server = new Server({
      plugin: this.serverPlugin,
      serverSecret: Buffer.alloc(32)
    })
    await this.server.listen()

    const { destinationAccount, sharedSecret } = this.server.generateAddressAndSecret()
    this.destinationAccount = destinationAccount
    this.sharedSecret = sharedSecret

    const connectionPromise = this.server.acceptConnection()

    this.clientConn = await createConnection({
      plugin: this.clientPlugin,
      destinationAccount,
      sharedSecret
    })

    this.serverConn = await connectionPromise
  })

  it('should be a Duplex stream', function () {
    const dataStream = this.clientConn.createDataStream()
    assert.instanceOf(dataStream, Duplex)
  })

  describe('Sending Data', function () {
    it('should send data', function (done) {
      this.serverConn.on('data_stream', (stream: DataStream) => {
        stream.on('data', (data: Buffer) => {
          assert.equal(data.toString(), 'hello')
          done()
        })
      })

      const clientStream = this.clientConn.createDataStream()
      clientStream.write('hello')
    })
  })

})