import 'mocha'
import { Connection } from '../src/connection'
import { createConnection, Server } from '../src/index'
import MockPlugin from './mocks/plugin'
import { MoneyStream } from '../src/money-stream'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
Chai.use(chaiAsPromised)
const assert = Object.assign(Chai.assert, sinon.assert)

describe('Connection', function () {
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

  describe('Sending Money', function () {
    it('should send money', async function () {
      const spy = sinon.spy()
      this.serverConn.on('money_stream', (moneyStream: MoneyStream) => {
        moneyStream.on('incoming', spy)
      })
      const clientStream = this.clientConn.createMoneyStream()
      clientStream.send(117)

      // TODO flushed should only resolve when the money has been received
      await clientStream.flushed()
      await new Promise((resolve, reject) => setImmediate(resolve))

      assert.calledOnce(spy)
      assert.calledWith(spy, '58')
    })
  })

  describe('Exchange Rate Handling', function () {

  })

  describe('Multiplexed MoneyStreams', function () {
    it('should send one packet for two streams if the amount does not exceed the Maximum Packet Amount', async function () {
      const incomingSpy = sinon.spy()
      const moneyStreamSpy = sinon.spy()
      const sendDataSpy = sinon.spy(this.clientPlugin, 'sendData')
      this.serverConn.on('money_stream', (moneyStream: MoneyStream) => {
        moneyStreamSpy()
        moneyStream.on('incoming', incomingSpy)
      })
      const clientStream1 = this.clientConn.createMoneyStream()
      const clientStream2 = this.clientConn.createMoneyStream()
      clientStream1.send(117)
      clientStream2.send(204)

      // TODO flushed should only resolve when the money has been received
      await clientStream1.flushed()
      await clientStream2.flushed()
      await new Promise((resolve, reject) => setImmediate(resolve))
      // TODO why is the second one necessary?
      await new Promise((resolve, reject) => setImmediate(resolve))

      assert.calledTwice(moneyStreamSpy)
      assert.calledTwice(incomingSpy)
      assert.calledWith(incomingSpy.firstCall, '58')
      assert.calledWith(incomingSpy.secondCall, '101')
      assert.calledOnce(sendDataSpy)
    })

  })
})
