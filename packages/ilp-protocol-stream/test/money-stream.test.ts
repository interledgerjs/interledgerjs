import 'mocha'
import { Connection } from '../src/connection'
import { createConnection, Server } from '../src/index'
import MockPlugin from './mocks/plugin'
import { MoneyStream } from '../src/money-stream'
import * as IlpPacket from 'ilp-packet'
import * as sinon from 'sinon'
import * as lolex from 'lolex'
import * as Chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
Chai.use(chaiAsPromised)
const assert = Object.assign(Chai.assert, sinon.assert)

describe('MoneyStream', function () {
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

  describe('setSendMax', function () {
    it('should send up to the amount specified', async function () {
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        stream.setReceiveMax(100000)
      })
      const clientStream = this.clientConn.createMoneyStream()
      clientStream.setSendMax(1000)

      await new Promise((resolve, reject) => {
        clientStream.on('total_sent', resolve)
      })
      assert.equal(clientStream.totalSent, '1000')
    })
  })

  describe('setReceiveMax', function () {
    it('should start at 0', async function () {
      const spy = sinon.spy()
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        stream.on('incoming', spy)
      })
      const clientStream = this.clientConn.createMoneyStream()
      clientStream.setSendMax(1000)

      await new Promise((resolve, reject) => setImmediate(resolve))
      await new Promise((resolve, reject) => setImmediate(resolve))
      assert.notCalled(spy)
      assert.equal(clientStream.totalSent, '0')
    })

    it('should accept the amount specified', async function () {
      const spy = sinon.spy()
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        stream.setReceiveMax(500)
        stream.on('incoming', spy)
      })
      const clientStream = this.clientConn.createMoneyStream()
      clientStream.setSendMax(1000)

      await new Promise((resolve, reject) => setImmediate(resolve))
      await new Promise((resolve, reject) => setImmediate(resolve))
      assert.callCount(spy, 1)
      assert.calledWith(spy, '500')
      assert.equal(clientStream.totalSent, '1000')
    })

    it('should accept more money if the limit is raised', async function () {
      const spy = sinon.spy()
      let serverStream: MoneyStream
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        serverStream = stream
        stream.setReceiveMax(500)
        stream.on('incoming', spy)
      })
      const clientStream = this.clientConn.createMoneyStream()
      clientStream.setSendMax(2000)

      await new Promise((resolve, reject) => setImmediate(resolve))
      await new Promise((resolve, reject) => setImmediate(resolve))
      assert.callCount(spy, 1)
      assert.calledWith(spy, '500')
      assert.equal(clientStream.totalSent, '1000')

      serverStream!.setReceiveMax(1000)
      await new Promise((resolve, reject) => setImmediate(resolve))

      assert.callCount(spy, 2)
      assert.calledWith(spy.firstCall, '500')
      assert.calledWith(spy.secondCall, '500')
      assert.equal(clientStream.totalSent, '2000')
      assert.equal(serverStream!.totalReceived, '1000')
    })
  })

  describe('send', function () {
    it('should raise the totalToSend by the specified amount and resolve when it has been sent')

    it('should resolve at the original target even if the amount is raised further')

    it('should reject if the stream is closed before the desired amount has been sent')
  })
})