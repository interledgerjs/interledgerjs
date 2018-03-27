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
    this.serverConn.on('money_stream', (stream: MoneyStream) => {
      stream.setReceiveMax(10000)
    })
  })

  describe('Sending Money', function () {
    it('should send money', async function () {
      const spy = sinon.spy()
      this.serverConn.on('money_stream', (moneyStream: MoneyStream) => {
        moneyStream.on('incoming', spy)
      })
      const clientStream = this.clientConn.createMoneyStream()
      await clientStream.sendTotal(117)

      assert.calledOnce(spy)
      assert.calledWith(spy, '58')
    })
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
      await Promise.all([clientStream1.sendTotal(117), clientStream2.sendTotal(204)])

      assert.calledTwice(moneyStreamSpy)
      assert.calledTwice(incomingSpy)
      assert.calledWith(incomingSpy.firstCall, '58')
      assert.calledWith(incomingSpy.secondCall, '101')
      assert.equal(IlpPacket.deserializeIlpPrepare(sendDataSpy.getCall(0).args[0]).amount, '321')
      assert.equal(IlpPacket.deserializeIlpPrepare(sendDataSpy.getCall(1).args[0]).amount, '0')
    })
  })

  describe('Exchange Rate Handling', function () {

  })

  describe('Maximum Packet Amount Handling', function () {
    it('should find the maximum amount immediately if the connector returns the receivedAmount and maximumAmount in the F08 error data', async function () {
      const spy = sinon.spy(this.clientPlugin, 'sendData')
      this.clientPlugin.maxAmount = 1500
      const clientStream = this.clientConn.createMoneyStream()
      await clientStream.sendTotal(2000)

      assert.callCount(spy, 4)
      assert.equal(IlpPacket.deserializeIlpPrepare(spy.getCall(0).args[0]).amount, '2000')
      assert.equal(IlpPacket.deserializeIlpPrepare(spy.getCall(1).args[0]).amount, '1500')
      assert.equal(IlpPacket.deserializeIlpPrepare(spy.getCall(2).args[0]).amount, '500')
      assert.equal(IlpPacket.deserializeIlpPrepare(spy.getCall(3).args[0]).amount, '0')
    })

    it('should keep reducing the packet amount if there are multiple connectors with progressively smaller maximums', async function () {
      const maxAmounts = [2857, 2233, 1675]
      const realSendData = this.clientPlugin.sendData
      let callCount = 0
      const args: Buffer[] = []
      this.clientPlugin.sendData = (data: Buffer) => {
        callCount++
        args[callCount - 1] = data
        if (callCount <= maxAmounts.length) {
          this.clientPlugin.maxAmount = maxAmounts[callCount - 1]
        }
        return realSendData.call(this.clientPlugin, data)
      }

      const clientStream = this.clientConn.createMoneyStream()
      await clientStream.sendTotal(3000)

      assert.equal(callCount, 6)
      assert.equal(IlpPacket.deserializeIlpPrepare(args[args.length - 3]).amount, '1675')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[args.length - 2]).amount, '1325')
      // last call is 0
    })

    it('should reduce the packet amount even if the error does not contain the correct error data', async function () {
      this.clientPlugin.maxAmount = 800
      const realSendData = this.clientPlugin.sendData
      let callCount = 0
      const args: Buffer[] = []
      this.clientPlugin.sendData = async (data: Buffer) => {
        callCount++
        args[callCount - 1] = data
        let result = await realSendData.call(this.clientPlugin, data)
        if (result[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
          result = IlpPacket.serializeIlpReject({
            ...IlpPacket.deserializeIlpReject(result),
            data: Buffer.alloc(0)
          })
        }
        return result
      }

      const clientStream = this.clientConn.createMoneyStream()
      await clientStream.sendTotal(2000)

      assert.equal(callCount, 6)
      assert.equal(IlpPacket.deserializeIlpPrepare(args[0]).amount, '2000')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[1]).amount, '999')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[2]).amount, '499')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[3]).amount, '748')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[4]).amount, '753')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[5]).amount, '0')
    })

    it('should approximate the maximum amount if the error data is non-sensical', async function () {
      this.clientPlugin.maxAmount = 800
      const realSendData = this.clientPlugin.sendData
      let callCount = 0
      const args: Buffer[] = []
      this.clientPlugin.sendData = async (data: Buffer) => {
        callCount++
        args[callCount - 1] = data
        let result = await realSendData.call(this.clientPlugin, data)
        if (result[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
          result = IlpPacket.serializeIlpReject({
            ...IlpPacket.deserializeIlpReject(result),
            data: Buffer.from('xcoivusadlfkjlwkerjlkjlkxcjvlkoiuiowedr', 'base64')
          })
        }
        return result
      }

      const clientStream = this.clientConn.createMoneyStream()
      await clientStream.sendTotal(2000)

      assert.equal(callCount, 6)
      assert.equal(IlpPacket.deserializeIlpPrepare(args[0]).amount, '2000')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[1]).amount, '999')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[2]).amount, '499')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[3]).amount, '748')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[4]).amount, '753')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[5]).amount, '0')
    })

    it('should stop sending if the maximum amount is too small to send any money through', async function () {
      this.clientPlugin.maxAmount = 0
      const clientStream = this.clientConn.createMoneyStream()

      return assert.isRejected(clientStream.sendTotal(1000))
    })
  })

  describe('Error Handling', function () {
    it('should emit an error and reject all flushed promises if a packet is rejected with an unexpected final error code', async function () {
      const sendDataStub = sinon.stub(this.clientPlugin, 'sendData')
      sendDataStub.resolves(IlpPacket.serializeIlpReject({
        code: 'F89',
        message: 'Blah',
        data: Buffer.alloc(0),
        triggeredBy: 'test.connector'
      }))

      const clientStream1 = this.clientConn.createMoneyStream()
      const clientStream2 = this.clientConn.createMoneyStream()

      return Promise.all([
        assert.isRejected(clientStream1.sendTotal(117), 'Unexpected error while sending packet. Code: F89, message: Blah'),
        assert.isRejected(clientStream2.sendTotal(204), 'Unexpected error while sending packet. Code: F89, message: Blah')
      ])
    })

    it('should retry on temporary errors', async function () {
      let clock: any
      const interval = setInterval(() => {
        if (clock) {
          clock.tick(100)
        }
      }, 1)
      clock = lolex.install({
        toFake: ['setTimeout']
      })
      const sendDataStub = sinon.stub(this.clientPlugin, 'sendData')
        .onFirstCall().resolves(IlpPacket.serializeIlpReject({
          code: 'T00',
          message: 'Internal Server Error',
          data: Buffer.alloc(0),
          triggeredBy: 'test.connector'
        }))
        .onSecondCall().resolves(IlpPacket.serializeIlpReject({
          code: 'T04',
          message: 'Insufficient Liquidity Error',
          data: Buffer.alloc(0),
          triggeredBy: 'test.connector'
        }))
        .onThirdCall().resolves(IlpPacket.serializeIlpReject({
          code: 'T89',
          message: 'Some other error',
          data: Buffer.alloc(0),
          triggeredBy: 'test.connector'
        }))
        .callThrough()

      const clientStream = this.clientConn.createMoneyStream()
      await clientStream.sendTotal(100)
      assert.callCount(sendDataStub, 4)
      clearInterval(interval)
      clock.uninstall()
    })

    it('should return the balance to the money streams if sending fails', async function () {
      const sendDataStub = sinon.stub(this.clientPlugin, 'sendData')
      sendDataStub.resolves(IlpPacket.serializeIlpReject({
        code: 'F89',
        message: 'Blah',
        data: Buffer.alloc(0),
        triggeredBy: 'test.connector'
      }))

      const clientStream1 = this.clientConn.createMoneyStream()

      await assert.isRejected(clientStream1.sendTotal(117), 'Unexpected error while sending packet. Code: F89, message: Blah')
      assert.equal(clientStream1.totalSent, '0')
    })
  })
})
