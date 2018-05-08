import 'mocha'
import { Connection } from '../src/connection'
import { createConnection, createServer } from '../src/index'
import MockPlugin from './mocks/plugin'
import { DataAndMoneyStream } from '../src/stream'
import * as IlpPacket from 'ilp-packet'
import * as sinon from 'sinon'
import * as lolex from 'lolex'
import * as Chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
Chai.use(chaiAsPromised)
const assert = Object.assign(Chai.assert, sinon.assert)
require('source-map-support').install()

describe('Connection', function () {
  beforeEach(async function () {
    this.clientPlugin = new MockPlugin(0.5)
    this.serverPlugin = this.clientPlugin.mirror

    this.server = await createServer({
      plugin: this.serverPlugin,
      serverSecret: Buffer.alloc(32)
    })

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
    this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
      stream.setReceiveMax(10000)
    })
  })

  describe('createStream', function () {
    it('should allow the client side to create streams', function (done) {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        done()
      })
      this.clientConn.createStream().setSendMax(10)
    })

    it('should allow the client side to create streams', function (done) {
      this.clientConn.on('stream', (stream: DataAndMoneyStream) => {
        done()
      })
      this.serverConn.createStream().setSendMax(10)
    })
  })

  describe('end', function () {
    it('should close the other side of the connection', async function () {
      const endSpy = sinon.spy()
      const closeSpy = sinon.spy()
      this.clientConn.on('end', endSpy)
      this.clientConn.on('close', closeSpy)

      await this.serverConn.end()
      assert.calledOnce(endSpy)
      assert.calledOnce(closeSpy)
    })

    it('should close all outgoing streams', async function () {
      const spy1 = sinon.spy()
      const spy2 = sinon.spy()
      const stream1 = this.clientConn.createStream()
      stream1.on('end', spy1)
      stream1.setSendMax(100)
      const stream2 = this.clientConn.createStream()
      stream2.write('hello')
      stream2.on('finish', spy2)

      await this.clientConn.end()

      assert.callCount(spy1, 1)
      assert.callCount(spy2, 1)
    })

    it.skip('should close all incoming streams', async function () {
      const moneySpy = sinon.spy()
      const dataSpy = sinon.spy()
      this.clientConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.on('end', () => {
          console.log('money stream end')
          moneySpy()
        })
      })
      this.clientConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.on('finish', () => {
          console.log('data strem end')
          dataSpy()
        })
      })
      this.serverConn.createStream().setSendMax(100)
      this.serverConn.createStream().write('hello')

      console.log('about to end')
      await this.clientConn.end()
      console.log('ended')

      assert.callCount(moneySpy, 1)
      assert.callCount(dataSpy, 1)
    })
  })

  describe('destroy', function () {
    it('should close the other side of the connection', function (done) {
      this.clientConn.on('close', done)
      this.serverConn.destroy()
    })

    it('should accept an error that will be emitted on the other side of the connection', function (done) {
      const spy = sinon.spy()
      this.clientConn.on('error', (err: Error) => {
        assert.equal(err.message, 'Remote connection error. Code: InternalError, message: i had enough of this')
        done()
      })

      this.serverConn.destroy(new Error('i had enough of this'))
    })

    it('should close all outgoing streams even if there is data and money still to send', function (done) {
      const spy = sinon.spy()
      const stream: DataAndMoneyStream = this.clientConn.createStream()
      stream.on('close', () => {
        spy()
        assert.calledOnce(spy)
        assert.equal(stream.totalSent, '0')
        // Don't use an assert.equal here because the behavior changed between Node 8 and 10
        assert.isAtLeast(stream.writableLength, 1)
        assert.equal(stream.isOpen(), false)
        done()
      })
      stream.setSendMax(100)
      stream.write(Buffer.alloc(20000))

      this.clientConn.destroy()
    })
  })

  describe('"stream" event', function () {
    it('should accept the money even if there is an error thrown in the event handler', async function () {
      this.serverConn.on('stream', (moneyStream: DataAndMoneyStream) => {
        throw new Error('blah')
      })
      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(117)
      assert.equal(clientStream.totalSent, '117')
    })
  })

  describe('Sending Money', function () {
    it('should send money', async function () {
      const spy = sinon.spy()
      this.serverConn.on('stream', (moneyStream: DataAndMoneyStream) => {
        moneyStream.on('money', spy)
      })
      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(117)

      assert.calledOnce(spy)
      assert.calledWith(spy, '58')
    })
  })

  describe('Multiplexed Money', function () {
    it('should send one packet for two streams if the amount does not exceed the Maximum Packet Amount', async function () {
      const incomingSpy = sinon.spy()
      const moneyStreamSpy = sinon.spy()
      const sendDataSpy = sinon.spy(this.clientPlugin, 'sendData')
      this.serverConn.on('stream', (moneyStream: DataAndMoneyStream) => {
        moneyStreamSpy()
        moneyStream.on('money', incomingSpy)
      })
      const clientStream1 = this.clientConn.createStream()
      const clientStream2 = this.clientConn.createStream()
      await Promise.all([clientStream1.sendTotal(117), clientStream2.sendTotal(204)])

      assert.calledTwice(moneyStreamSpy)
      assert.calledTwice(incomingSpy)
      assert.calledWith(incomingSpy.firstCall, '58')
      assert.calledWith(incomingSpy.secondCall, '101')
      assert.equal(IlpPacket.deserializeIlpPrepare(sendDataSpy.getCall(0).args[0]).amount, '321')
    })
  })

  describe('Exchange Rate Handling', function () {
    it('should reject and retry packets if the exchange rate is worse than the minimum acceptable rate', async function () {
      this.clientPlugin.maxAmount = 400
      const exchangeRates = [0.5, 0.75, 0.25, 0.1, 0.49, 0.5, 1.25]
      const realSendData = this.clientPlugin.sendData
      let callCount = 0
      const args: Buffer[] = []
      let rejected: Array<IlpPacket.IlpRejection> = []
      this.clientPlugin.sendData = async (data: Buffer) => {
        callCount++
        args[callCount - 1] = data
        if (callCount <= exchangeRates.length) {
          this.clientPlugin.exchangeRate = exchangeRates[callCount - 1]
        }
        const response = await realSendData.call(this.clientPlugin, data)
        if(response[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
          rejected.push(IlpPacket.deserializeIlpReject(response))
        }
        return response
      }

      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(2000)

      // F99X Are Application Errors due to the exchange rate dropping below the minimum acceptable amount
      assert.equal(rejected[0].message, 'Packet amount too large')
      assert.equal(rejected[1].code.includes('F99'), true)
      assert.equal(rejected[2].code.includes('F99'), true)
      assert.equal(rejected[3].code.includes('F99'), true)
    })

    it('should reject and retry packets if the exchange rate is worse than the minimum acceptable amount - slippage', async function() {
      this.clientPlugin.deregisterDataHandler()
      this.serverPlugin.deregisterDataHandler()

      this.server = await createServer({
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
        sharedSecret,
        slippage: 0.05
      })
      this.serverConn = await connectionPromise
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(10000)
      })

      this.clientPlugin.maxAmount = 400
      const exchangeRates = [0.5, 0.49, 0.48, 0.47, 0.5, 0.46, 0.7]
      const realSendData = this.clientPlugin.sendData.bind(this.clientPlugin)
      let callCount = 0
      const args: Buffer[] = []
      let rejected: Array<IlpPacket.IlpRejection> = []
      this.clientPlugin.sendData = async (data: Buffer) => {
        callCount++
        args[callCount - 1] = data
        if (callCount <= exchangeRates.length) {
          this.clientPlugin.exchangeRate = exchangeRates[callCount - 1]
        }
        const response = await realSendData.call(this.clientPlugin, data)
        if (response[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
          rejected.push(IlpPacket.deserializeIlpReject(response))
        }
        return response
      }

      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(2000)

      // F99X Are Application Errors due to the exchange rate dropping below the minimum acceptable amount + slippage
      assert.equal(rejected[0].message, 'Packet amount too large')
      assert.equal(rejected[1].code.includes('F99'), true)
      assert.equal(rejected[2].code.includes('F99'), true)
    })

    it('should properly calcuate the total received, sent, and delivered for the client and the server', async function () {
      this.clientPlugin.deregisterDataHandler()
      this.serverPlugin.deregisterDataHandler()

      this.server = await createServer({
        plugin: this.serverPlugin,
        serverSecret: Buffer.alloc(32),
        slippage: 0.01
      })
      await this.server.listen()

      const { destinationAccount, sharedSecret } = this.server.generateAddressAndSecret()
      this.destinationAccount = destinationAccount
      this.sharedSecret = sharedSecret

      const connectionPromise = this.server.acceptConnection()
      this.clientPlugin.maxAmount = 400

      this.clientConn = await createConnection({
        plugin: this.clientPlugin,
        destinationAccount,
        sharedSecret,
        slippage: 0.05
      })
      this.serverConn = await connectionPromise
      this.serverConn.on('stream', async (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(10000)
        await stream.sendTotal(111)
      })

      const clientStream = this.clientConn.createStream()
      clientStream.setReceiveMax(10000)
      await clientStream.sendTotal(2000)

      // Server Sends 111
      assert.equal(this.clientConn.totalReceived, 222)
      assert.equal(this.serverConn.totalDelivered, 222)
      assert.equal(this.serverConn.totalSent, 111)

      // Client Sends 2000
      assert.equal(this.serverConn.totalReceived, 1000)
      assert.equal(this.clientConn.totalDelivered, 1000)
      assert.equal(this.clientConn.totalSent, 2000)

      // Check Minimum Exchange Rates
      assert.equal(this.serverConn.minimumAcceptableExchangeRate, 1.98)
      assert.equal(this.clientConn.minimumAcceptableExchangeRate, 0.475)

      // Check Last Packet Exchange Rate
      assert.equal(this.serverConn.lastPacketExchangeRate, 2)
      assert.equal(this.clientConn.lastPacketExchangeRate, 0.5)
    })
  })

  describe('Maximum Packet Amount Handling', function () {
    it('should find the maximum amount immediately if the connector returns the receivedAmount and maximumAmount in the F08 error data', async function () {
      const spy = sinon.spy(this.clientPlugin, 'sendData')
      this.clientPlugin.maxAmount = 1500
      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(2000)

      assert.equal(IlpPacket.deserializeIlpPrepare(spy.getCall(0).args[0]).amount, '2000')
      assert.equal(IlpPacket.deserializeIlpPrepare(spy.getCall(1).args[0]).amount, '1500')
      assert.equal(IlpPacket.deserializeIlpPrepare(spy.getCall(2).args[0]).amount, '500')
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

      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(3000)

      assert.equal(callCount, 5)
      assert.equal(IlpPacket.deserializeIlpPrepare(args[args.length - 2]).amount, '1675')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[args.length - 1]).amount, '1325')
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

      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(2000)

      assert.equal(callCount, 5)
      assert.equal(IlpPacket.deserializeIlpPrepare(args[0]).amount, '2000')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[1]).amount, '999')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[2]).amount, '499')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[3]).amount, '748')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[4]).amount, '753')
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

      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(2000)

      assert.equal(IlpPacket.deserializeIlpPrepare(args[0]).amount, '2000')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[1]).amount, '999')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[2]).amount, '499')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[3]).amount, '748')
      assert.equal(IlpPacket.deserializeIlpPrepare(args[4]).amount, '753')
    })

    it('should stop sending if the maximum amount is too small to send any money through', async function () {
      this.clientPlugin.maxAmount = 0
      this.serverConn.on('error', (err: Error) => {
        assert.equal(err.message, 'Cannot send. Path has a Maximum Packet Amount of 0')
      })
      const clientStream = this.clientConn.createStream()
      clientStream.on('error', (err: Error) => {
        assert.equal(err.message, 'Cannot send. Path has a Maximum Packet Amount of 0')
      })
      this.clientConn.on('error', (err: Error) => {
        assert.equal(err.message, 'Cannot send. Path has a Maximum Packet Amount of 0')
      })

      await assert.isRejected(clientStream.sendTotal(1000), 'Stream was closed before desired amount was sent (target: 1000, totalSent: 0)')
    })
  })

  describe('Error Handling', function () {
    it('should emit an error and reject all flushed promises if a packet is rejected with an unexpected final error code', async function () {
      const sendDataStub = sinon.stub(this.clientPlugin, 'sendData')
      const spy = sinon.spy()
      this.clientConn.on('error', spy)
      sendDataStub.resolves(IlpPacket.serializeIlpReject({
        code: 'F89',
        message: 'Blah',
        data: Buffer.alloc(0),
        triggeredBy: 'test.connector'
      }))

      const clientStream1 = this.clientConn.createStream()
      const clientStream2 = this.clientConn.createStream()

      await Promise.all([
        assert.isRejected(clientStream1.sendTotal(117), 'Stream was closed before desired amount was sent (target: 117, totalSent: 0)'),
        assert.isRejected(clientStream2.sendTotal(204), 'Stream was closed before desired amount was sent (target: 204, totalSent: 0)')
      ])
      await new Promise(setImmediate)
      assert.callCount(spy, 1)
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

      const clientStream = this.clientConn.createStream()
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

      const clientStream1 = this.clientConn.createStream()

      await assert.isRejected(clientStream1.sendTotal(117), 'Stream was closed before desired amount was sent (target: 117, totalSent: 0)')
      assert.equal(clientStream1.totalSent, '0')
    })
  })

  describe('Padding', function () {
    it('should allow packets to be padded to the maximum size', async function () {
      this.clientPlugin.deregisterDataHandler()
      this.serverPlugin.deregisterDataHandler()

      this.server = await createServer({
        plugin: this.serverPlugin,
        serverSecret: Buffer.alloc(32),
        enablePadding: true
      })

      const { destinationAccount, sharedSecret } = this.server.generateAddressAndSecret()
      this.destinationAccount = destinationAccount
      this.sharedSecret = sharedSecret

      const connectionPromise = this.server.acceptConnection()

      this.clientConn = await createConnection({
        plugin: this.clientPlugin,
        destinationAccount,
        sharedSecret,
        enablePadding: true
      })
      this.serverConn = await connectionPromise
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(10000)
      })

      const realSendData = this.clientPlugin.sendData.bind(this.clientPlugin)
      const lengths: number[] = []
      this.clientPlugin.sendData = async (data: Buffer): Promise<Buffer> => {
        lengths.push(IlpPacket.deserializeIlpPrepare(data).data.length)
        const response = await realSendData(data)
        if (response[0] === IlpPacket.Type.TYPE_ILP_FULFILL) {
          lengths.push(IlpPacket.deserializeIlpFulfill(response).data.length)
        } else {
          lengths.push(IlpPacket.deserializeIlpReject(response).data.length)
        }
        return response
      }
      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(117)

      for (let length of lengths) {
        assert.equal(length, 32767)
      }
    })
  })

  describe('Stream IDs', function () {
    it('should close the connection if the peer uses the wrong numbered stream ID', function (done) {
      const { destinationAccount, sharedSecret } = this.server.generateAddressAndSecret()
      const clientPlugin = this.clientPlugin
      class BadConnection extends Connection {
        constructor () {
          super({
            plugin: clientPlugin,
            destinationAccount,
            sourceAccount: 'test.peerB',
            sharedSecret,
            isServer: false
          })
          this.nextStreamId = 2
        }
      }
      const clientConn = new BadConnection()
      clientConn.on('error', (err: Error) => {
        assert.equal(err.message, 'Remote connection error. Code: ProtocolViolation, message: Invalid Stream ID: 2. Client-initiated streams must have odd-numbered IDs')
        done()
      })
      clientConn.connect()
      const stream = clientConn.createStream()
      stream.on('error', (err: Error) => {
        assert.equal(err.message, 'Remote connection error. Code: ProtocolViolation, message: Invalid Stream ID: 2. Client-initiated streams must have odd-numbered IDs')
      })
    })

    it.skip('should remove the connection on the server side if the client violates the protocol')

    it('should close the connection if the peer opens too many streams', async function () {
      const spy = sinon.spy()
      const { destinationAccount, sharedSecret } = this.server.generateAddressAndSecret()
      this.server.on('connection', (serverConn: Connection) => {
        serverConn['maxStreamId'] = 6
        serverConn.on('stream', (stream: DataAndMoneyStream) => {
          stream.on('error', (err: Error) => {})
        })
        serverConn.on('error', (err: Error) => {})
      })
      const clientPlugin = this.clientPlugin
      class BadConnection extends Connection {
        remoteMaxStreamId: number

        constructor () {
          super({
            plugin: clientPlugin,
            destinationAccount,
            sourceAccount: 'test.peerB',
            sharedSecret,
            isServer: false
          })
        }
      }
      const clientConn = new BadConnection()
      clientConn.on('error', spy)
      await clientConn.connect()
      clientConn.remoteMaxStreamId = 100
      const streams = [
        clientConn.createStream(),
        clientConn.createStream(),
        clientConn.createStream(),
        clientConn.createStream()
      ]

      await Promise.all(streams.map((stream: DataAndMoneyStream) => assert.isRejected(stream.sendTotal(10))))

      assert.equal(spy.firstCall.args[0].message, 'Remote connection error. Code: StreamIdError, message: Maximum number of open streams exceeded. Got stream: 7, current max stream ID: 6')
    })

    it('should allow the user to set the maximum number of open streams', async function () {
      const serverConnPromise = this.server.acceptConnection()
      const clientConn = await createConnection({
        ...this.server.generateAddressAndSecret(),
        plugin: this.clientPlugin,
        maxRemoteStreams: 1
      })
      const serverConn = await serverConnPromise

      const spy = sinon.spy()
      const clientSpy = sinon.spy()
      const serverSpy = sinon.spy()
      clientConn.on('error', clientSpy)
      serverConn.on('error', serverSpy)

      await assert.isRejected(Promise.all([
        serverConn.createStream().sendTotal(10),
        serverConn.createStream().sendTotal(10)
      ]))

      assert.equal(clientSpy.args[0][0].message, 'Maximum number of open streams exceeded. Got stream: 4, current max stream ID: 2')
      assert.equal(serverSpy.args[0][0].message, 'Remote connection error. Code: StreamIdError, message: Maximum number of open streams exceeded. Got stream: 4, current max stream ID: 2')
    })

    it('should throw an error when the user calls createStream if it would exceed the other side\'s limit', async function () {
      const serverConnPromise = this.server.acceptConnection()
      const clientConn = await createConnection({
        ...this.server.generateAddressAndSecret(),
        plugin: this.clientPlugin,
        maxRemoteStreams: 2
      })
      const serverConn = await serverConnPromise
      clientConn.on('stream', (stream: DataAndMoneyStream) => { stream.setReceiveMax(100) })

      await Promise.all([
        serverConn.createStream().sendTotal(10),
        serverConn.createStream().sendTotal(10)
      ])

      assert.throws(() => serverConn.createStream(), `Creating another stream would exceed the remote connection's maximum number of open streams`)
    })

    it('should increase the max stream id as streams are closed', async function () {
      const serverConnPromise = this.server.acceptConnection()
      const clientConn = await createConnection({
        ...this.server.generateAddressAndSecret(),
        plugin: this.clientPlugin,
        maxRemoteStreams: 2
      })
      const serverConn = await serverConnPromise
      clientConn.on('stream', (stream: DataAndMoneyStream) => { stream.setReceiveMax(100) })
      const streams = [serverConn.createStream(), serverConn.createStream()]
      await Promise.all(streams.map((stream: DataAndMoneyStream) => stream.sendTotal(10)))
      assert.throws(() => serverConn.createStream())

      streams[0].end()
      await new Promise((resolve, reject) => setImmediate(resolve))
      await new Promise((resolve, reject) => setImmediate(resolve))

      assert.doesNotThrow(() => serverConn.createStream())
    })
  })

  describe('Flow Control', function () {
    it('should respect the remote connection-level flow control', async function () {
      const serverStreams: DataAndMoneyStream[] = []
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => serverStreams.push(stream))
      const streams = [
        this.clientConn.createStream(),
        this.clientConn.createStream(),
        this.clientConn.createStream(),
        this.clientConn.createStream(),
        this.clientConn.createStream()
      ]
      const data = Buffer.alloc(1000)
      for (let stream of streams) {
        for (let i = 0; i < 20; i++) {
          stream.write(data)
        }
      }

      await new Promise(setImmediate)
      await new Promise(setImmediate)
      await new Promise(setImmediate)

      const bytesBuffered = serverStreams.reduce((sum, stream) => sum + stream.readableLength, 0)
      // Max data - estimated overhead for StreamDataFrame
      assert.equal(bytesBuffered, 2 * 32767 - 20)
    })

    it('should close the connection if the remote sends too much data', async function () {
      const spy = sinon.spy()
      this.clientConn.on('error', spy)

      const streams = [
        this.clientConn.createStream(),
        this.clientConn.createStream(),
        this.clientConn.createStream(),
        this.clientConn.createStream(),
        this.clientConn.createStream()
      ]
      const data = Buffer.alloc(16384)
      for (let stream of streams) {
        stream.write(data)
      }
      await new Promise(setImmediate)
      this.clientConn['remoteMaxOffset'] = 999999999
      await new Promise(setImmediate)
      this.clientConn['remoteMaxOffset'] = 999999999
      await new Promise(setImmediate)

      assert.calledOnce(spy)
      assert.equal(spy.args[0][0].message, 'Remote connection error. Code: FlowControlError, message: Exceeded flow control limits. Max connection byte offset: 65534, received: 81920')
    })

    it('should close the connection if the remote does not respect stream-level flow control', async function () {
      const spy = sinon.spy()
      this.clientConn.on('error', spy)

      const clientStream = this.clientConn.createStream()
      const data = Buffer.alloc(1000)
      for (let i = 0; i < 20; i++) {
        clientStream.write(data)
      }

      clientStream._remoteMaxOffset = 999999
      await new Promise(setImmediate)

      assert.calledOnce(spy)
      assert.equal(spy.args[0][0].message, 'Remote connection error. Code: InternalError, message: Exceeded flow control limits. Stream 1 can accept up to offset: 16384 but got bytes up to offset: 20000')
    })

    it('should allow the per-connection buffer size to be configured', async function () {
      this.serverPlugin.deregisterDataHandler()
      this.clientPlugin.deregisterDataHandler()

      const server = await createServer({
        plugin: this.serverPlugin,
        serverSecret: Buffer.alloc(32),
        connectionBufferSize: 2000
      })

      const serverConnPromise = server.acceptConnection()

      const clientConn = await createConnection({
        ...server.generateAddressAndSecret(),
        plugin: this.clientPlugin,
        connectionBufferSize: 2500
      })

      const serverConn = await serverConnPromise

      assert.equal(serverConn['maxBufferedData'], 2000)
      assert.equal(clientConn['maxBufferedData'], 2500)
    })
  })
})
