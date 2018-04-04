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
require('source-map-support').install()

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

    it('should throw if the amount is lower than the totalSent already', async function () {
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        stream.setReceiveMax(100000)
      })
      const clientStream = this.clientConn.createMoneyStream()
      clientStream.setSendMax(1000)

      await new Promise((resolve, reject) => {
        clientStream.on('total_sent', resolve)
      })

      assert.throws(() => clientStream.setSendMax(500), 'Cannot set sendMax lower than the totalSent')
    })

    it('should throw if the amount is infinite', function () {
      const clientStream = this.clientConn.createMoneyStream()
      assert.throws(() => clientStream.setSendMax(Infinity), 'sendMax must be finite')
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
      await new Promise((resolve, reject) => setImmediate(resolve))
      assert.callCount(spy, 1)
      assert.calledWith(spy, '500')
      assert.equal(clientStream.totalSent, '1000')

      serverStream!.setReceiveMax(1000)
      await new Promise((resolve, reject) => setImmediate(resolve))
      await new Promise((resolve, reject) => setImmediate(resolve))
      await new Promise((resolve, reject) => setImmediate(resolve))

      assert.callCount(spy, 2)
      assert.calledWith(spy.firstCall, '500')
      assert.calledWith(spy.secondCall, '500')
      assert.equal(clientStream.totalSent, '2000')
      assert.equal(serverStream!.totalReceived, '1000')
    })

    it('should throw if the specified amount is lower than the amount already received', function (done) {
      this.serverConn.on('money_stream', async (stream: MoneyStream) => {
        stream.setReceiveMax(500)

        await new Promise((resolve, reject) => setImmediate(resolve))
        await new Promise((resolve, reject) => setImmediate(resolve))

        assert.equal(stream.totalReceived, '500')
        assert.throws(() => stream.setReceiveMax(200), 'Cannot set receiveMax lower than the totalReceived')
        done()
      })

      const clientStream = this.clientConn.createMoneyStream()
      clientStream.setSendMax(2000)
    })

    it('should allow the limit to be set to Infinity', async function () {
      const spy = sinon.spy()
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        stream.setReceiveMax(Infinity)
        stream.on('incoming', spy)
      })
      const clientStream = this.clientConn.createMoneyStream()
      await clientStream.sendTotal(1000)
      assert.callCount(spy, 1)
      assert.calledWith(spy, '500')
      assert.equal(clientStream.totalSent, '1000')
    })
  })

  describe('sendTotal', function () {
    it('should send the specified amount and resolve when it has been sent', async function () {
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        stream.setReceiveMax(100000)
      })
      const clientStream = this.clientConn.createMoneyStream()
      await clientStream.sendTotal(1000)

      assert.equal(clientStream.totalSent, '1000')
    })

    it('should raise the send limit to the amount specified and resolve when the larger amount has been sent', async function () {
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        stream.setReceiveMax(100000)
      })
      const clientStream = this.clientConn.createMoneyStream()
      await clientStream.sendTotal(1000)
      await clientStream.sendTotal(2000)

      assert.equal(clientStream.totalSent, '2000')
    })

    it('should resolve immediately if the amount specified is less than the amount already sent', async function () {
      const spy = sinon.spy(this.clientPlugin, 'sendData')
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        stream.setReceiveMax(100000)
      })

      const clientStream = this.clientConn.createMoneyStream()
      await clientStream.sendTotal(1000)
      const count = spy.callCount

      await clientStream.sendTotal(500)
      assert.equal(spy.callCount, count)
    })

    it('should reject if the stream closes before the amount has been sent', async function () {
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        stream.end()
      })

      const clientStream = this.clientConn.createMoneyStream()
      await assert.isRejected(clientStream.sendTotal(1000), 'Stream was closed before desired amount was sent (target: 1000, totalSent: 0)')
    })

    it.skip('should reject if there is an error sending before the amount has been sent')
  })

  describe('receiveTotal', function () {
    it('should resolve when the specified amount has been received', async function () {
      let receivedPromise: Promise<any>
      let receiverStream: MoneyStream
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        receiverStream = stream
        receivedPromise = stream.receiveTotal(500)
      })
      const clientStream = this.clientConn.createMoneyStream()
      clientStream.setSendMax(1000)
      await new Promise((resolve, reject) => setImmediate(resolve))

      await receivedPromise!
      assert.equal(receiverStream!.totalReceived, '500')

      await new Promise((resolve, reject) => setImmediate(resolve))
      assert.equal(clientStream.totalSent, '1000')
    })

    it('should allow the limit to be raised and resolve when the higher amount has been received', function (done) {
      this.serverConn.on('money_stream', async (stream: MoneyStream): Promise<void> => {
        await stream.receiveTotal(500)
        await stream.receiveTotal(1000)

        assert.equal(stream.totalReceived, '1000')
        done()
      })
      const clientStream = this.clientConn.createMoneyStream()
      clientStream.setSendMax(2000)
    })

    it('should resolve immediately if the amount specified is less than the amount already received', function (done) {
      const spy = sinon.spy(this.clientPlugin, 'sendData')
      this.serverConn.on('money_stream', async (stream: MoneyStream): Promise<void> => {
        await stream.receiveTotal(500)
        const count = spy.callCount
        await stream.receiveTotal(200)

        assert.equal(stream.totalReceived, '500')
        assert.equal(spy.callCount, count)
        done()
      })
      const clientStream = this.clientConn.createMoneyStream()
      clientStream.setSendMax(2000)
    })

    it('should reject if the stream closes before the amount has been received', async function () {
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        stream.end()
      })

      const clientStream = this.clientConn.createMoneyStream()
      await assert.isRejected(clientStream.receiveTotal(1000), 'Stream was closed before desired amount was received (target: 1000, totalReceived: 0)')
    })

    it.skip('should reject if there is an error sending before the amount has been received')
  })

  describe('end', function () {
    it('should close the stream on the other side', function (done) {
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        stream.setReceiveMax(1000)
        stream.on('end', done)
      })

      const clientStream = this.clientConn.createMoneyStream()
      clientStream.sendTotal(1000)
        .then(() => clientStream.end())
    })

    it('should allow a stream to send some money and be closed right away', function (done) {
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        stream.setReceiveMax(1000)
        stream.on('end', done)
      })

      const clientStream = this.clientConn.createMoneyStream()
      clientStream.setSendMax(1000)
      clientStream.end()
    })

    it('should reject all incoming packets with money for the closed stream', function (done) {
      const spy = sinon.spy()
      this.serverConn.on('money_stream', (stream: MoneyStream) => {
        stream.setReceiveMax(1000)
        stream.end()
        stream.on('incoming', spy)
      })

      const clientStream = this.clientConn.createMoneyStream()
      clientStream.setSendMax(1000)
      clientStream.on('end', () => {
        assert.equal(clientStream.totalSent, '0')
        assert.notCalled(spy)
        done()
      })
    })
  })
})