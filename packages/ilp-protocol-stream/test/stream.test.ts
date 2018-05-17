import 'mocha'
import { Connection } from '../src/connection'
import { createConnection, Server } from '../src/index'
import MockPlugin from './mocks/plugin'
import { DataAndMoneyStream } from '../src/stream'
import { Duplex } from 'stream'
import * as IlpPacket from 'ilp-packet'
import { Packet, StreamCloseFrame, ErrorCode } from '../src/packet'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
Chai.use(chaiAsPromised)
const assert = Object.assign(Chai.assert, sinon.assert)
require('source-map-support').install()

describe('DataAndMoneyStream', function () {
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
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(100000)
      })
      const clientStream = this.clientConn.createStream()
      clientStream.setSendMax(1000)

      await new Promise((resolve, reject) => {
        clientStream.on('outgoing_total_sent', resolve)
      })
      assert.equal(clientStream.totalSent, '1000')
    })

    it('should throw if the amount is lower than the totalSent already', async function () {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(100000)
      })
      const clientStream = this.clientConn.createStream()
      clientStream.setSendMax(1000)

      await new Promise((resolve, reject) => {
        clientStream.on('outgoing_total_sent', resolve)
      })

      assert.throws(() => clientStream.setSendMax(500), 'Cannot set sendMax lower than the totalSent')
    })

    it('should throw if the amount is infinite', function () {
      const clientStream = this.clientConn.createStream()
      assert.throws(() => clientStream.setSendMax(Infinity), 'sendMax must be finite')
    })
  })

  describe('setReceiveMax', function () {
    it('should start at 0', async function () {
      const spy = sinon.spy()
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.on('money', spy)
      })
      const clientStream = this.clientConn.createStream()
      clientStream.setSendMax(1000)

      await new Promise((resolve, reject) => setImmediate(resolve))
      await new Promise((resolve, reject) => setImmediate(resolve))
      assert.notCalled(spy)
      assert.equal(clientStream.totalSent, '0')
    })

    it('should accept the amount specified', async function () {
      const spy = sinon.spy()
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(500)
        stream.on('money', spy)
      })
      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(1000)
      assert.callCount(spy, 1)
      assert.calledWith(spy, '500')
      assert.equal(clientStream.totalSent, '1000')
    })

    it('should accept money if the receiveMax is raised after an async call', async function () {
      const spy = sinon.spy()
      this.serverConn.on('stream', async (stream: DataAndMoneyStream) => {
        await new Promise((resolve, reject) => setTimeout(resolve, 10))
        stream.setReceiveMax(500)
        stream.on('money', spy)
      })
      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(1000)
      assert.callCount(spy, 1)
      assert.calledWith(spy, '500')
      assert.equal(clientStream.totalSent, '1000')
    })

    it('should accept more money if the limit is raised', async function () {
      const spy = sinon.spy()
      let serverStream: DataAndMoneyStream
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        serverStream = stream
        stream.setReceiveMax(500)
        stream.on('money', spy)
      })
      const clientStream = this.clientConn.createStream()
      clientStream.setSendMax(2000)

      await new Promise((resolve, reject) => setImmediate(resolve))
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
      this.serverConn.on('stream', async (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(500)

        await new Promise((resolve, reject) => setImmediate(resolve))
        await new Promise((resolve, reject) => setImmediate(resolve))

        assert.equal(stream.totalReceived, '500')
        assert.throws(() => stream.setReceiveMax(200), 'Cannot set receiveMax lower than the totalReceived')
        done()
      })

      const clientStream = this.clientConn.createStream()
      clientStream.setSendMax(2000)
    })

    it('should allow the limit to be set to Infinity', async function () {
      const spy = sinon.spy()
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(Infinity)
        stream.on('money', spy)
      })
      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(1000)
      assert.callCount(spy, 1)
      assert.calledWith(spy, '500')
      assert.equal(clientStream.totalSent, '1000')
    })
  })

  describe('sendTotal', function () {
    it('should send the specified amount and resolve when it has been sent', async function () {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(100000)
      })
      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(1000)

      assert.equal(clientStream.totalSent, '1000')
    })

    it('should raise the send limit to the amount specified and resolve when the larger amount has been sent', async function () {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(100000)
      })
      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(1000)
      await clientStream.sendTotal(2000)

      assert.equal(clientStream.totalSent, '2000')
    })

    it('should resolve immediately if the amount specified is less than the amount already sent', async function () {
      const spy = sinon.spy(this.clientPlugin, 'sendData')
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(100000)
      })

      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(1000)
      const count = spy.callCount

      await clientStream.sendTotal(500)
      assert.equal(spy.callCount, count)
    })

    it('should reject if the stream closes before the amount has been sent', async function () {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.end()
      })

      const clientStream = this.clientConn.createStream()
      await assert.isRejected(clientStream.sendTotal(1000), 'Stream was closed before the desired amount was sent (target: 1000, totalSent: 0)')
    })

    it('should reject if the stream is destroyed before the amount has been sent', async function () {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.destroy(new Error('blah'))
        stream.on('error', (err: Error) => {
          assert.equal(err.message, 'blah')
        })
      })

      const clientStream = this.clientConn.createStream()
      await assert.isRejected(clientStream.sendTotal(1000), 'Stream encountered an error before the desired amount was sent (target: 1000, totalSent: 0): ApplicationError: blah')
    })

    it('should reject if there is an error before the amount has been sent', async function () {
      const clientStream = this.clientConn.createStream()
      const sendPromise = clientStream.sendTotal(1000)
      clientStream.emit('error', new Error('oops'))
      await assert.isRejected(sendPromise, 'Stream encountered an error before the desired amount was sent (target: 1000, totalSent: 0): Error: oops')
    })

    it('should retry sending total if rejected by the receiver', async function() {
      const moneySpy = sinon.spy()
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(500)
        stream.on('money', moneySpy)
      })

      sinon.stub(this.clientPlugin, 'sendData')
        .onFirstCall()
        .resolves(IlpPacket.serializeIlpReject({
          code: 'F99',
          message: 'uh oh',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        }))
        .callThrough()

      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(1000)
      assert.calledOnce(moneySpy)
      assert.equal(clientStream.totalSent, '1000')
    })

    it('should retry sending total if rejected by a connector', async function() {
      const moneySpy = sinon.spy()
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(500)
        stream.on('money', moneySpy)
      })

      sinon.stub(this.clientPlugin, 'sendData')
        .onFirstCall()
        .resolves(IlpPacket.serializeIlpReject({
          code: 'T00',
          message: 'uh oh',
          triggeredBy: 'test.connector',
          data: Buffer.alloc(0)
        }))
        .callThrough()

      const clientStream = this.clientConn.createStream()
      await clientStream.sendTotal(1000)
      assert.calledOnce(moneySpy)
      assert.equal(clientStream.totalSent, '1000')
    })
  })

  describe('receiveTotal', function () {
    it('should resolve when the specified amount has been received', async function () {
      let receivedPromise: Promise<any>
      let receiverStream: DataAndMoneyStream
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        receiverStream = stream
        receivedPromise = stream.receiveTotal(500)
      })
      const clientStream = this.clientConn.createStream()
      clientStream.setSendMax(1000)
      await new Promise((resolve, reject) => setImmediate(resolve))
      await new Promise((resolve, reject) => setImmediate(resolve))

      await receivedPromise!
      assert.equal(receiverStream!.totalReceived, '500')

      await new Promise((resolve, reject) => setImmediate(resolve))
      assert.equal(clientStream.totalSent, '1000')
    })

    it('should allow the limit to be raised and resolve when the higher amount has been received', function (done) {
      this.serverConn.on('stream', async (stream: DataAndMoneyStream): Promise<void> => {
        await stream.receiveTotal(500)
        await stream.receiveTotal(1000)

        assert.equal(stream.totalReceived, '1000')
        done()
      })
      const clientStream = this.clientConn.createStream()
      clientStream.setSendMax(2000)
    })

    it('should resolve immediately if the amount specified is less than the amount already received', function (done) {
      const spy = sinon.spy(this.clientPlugin, 'sendData')
      this.serverConn.on('stream', async (stream: DataAndMoneyStream): Promise<void> => {
        await stream.receiveTotal(500)
        const count = spy.callCount
        await stream.receiveTotal(200)

        assert.equal(stream.totalReceived, '500')
        assert.equal(spy.callCount, count)
        done()
      })
      const clientStream = this.clientConn.createStream()
      clientStream.setSendMax(2000)
    })

    it('should reject if the stream closes before the amount has been received', async function () {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.end()
      })

      const clientStream = this.clientConn.createStream()
      await assert.isRejected(clientStream.receiveTotal(1000), 'Stream was closed before the desired amount was received (target: 1000, totalReceived: 0)')
    })

    it('should reject if the stream is destroyed before the amount has been received', async function () {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.destroy(new Error('blah'))
        stream.on('error', () => {})
      })

      const clientStream = this.clientConn.createStream()
      await assert.isRejected(clientStream.receiveTotal(1000), 'Stream encountered an error before the desired amount was received (target: 1000, totalReceived: 0): ApplicationError: blah')
    })

    it('should reject if there is an error before the amount has been received', async function () {
      const clientStream = this.clientConn.createStream()
      const receivePromise = clientStream.receiveTotal(1000)
      clientStream.emit('error', new Error('oops'))
      clientStream.on('error', () => {})
      await assert.isRejected(receivePromise, 'Stream encountered an error before the desired amount was received (target: 1000, totalReceived: 0)')
    })
  })

  describe('end', function () {
    it('should end without opening connection on other side if no data sent', function (done) {
      const clientEnd = sinon.spy()
      this.serverConn.on('stream', () => {
        done('client opened connection to server')
      })
      const stream = this.clientConn.createStream()
      stream.on('end', async () => {
        clientEnd()
        assert.calledOnce(clientEnd)
        done()
      })
      stream.end()
    })

    it('should accept data', function (done) {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        let data: Buffer
        stream.on('data', (chunk: Buffer) => {
          data = chunk
        })
        stream.on('end', () => {
          assert.equal(data.toString(), 'hello')
          done()
        })
      })
      const stream = this.clientConn.createStream()
      stream.end('hello')
    })

    it('should close the stream on the other side', function (done) {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(1000)
        stream.on('end', done)
      })

      const clientStream = this.clientConn.createStream()
      clientStream.sendTotal(1000)
        .then(() => clientStream.end())
    })

    it('should not close the stream until all the money has been sent', function (done) {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(1000)
      })
      const clientStream = this.clientConn.createStream()
      clientStream.setSendMax(1000)
      clientStream.end()
      clientStream.on('end', () => {
        assert.equal(clientStream.totalSent, '1000')
        done()
      })
    })

    it('should not close the stream until all the data has been sent', async function () {
      let data: Buffer[] = []
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.on('data', (chunk: Buffer) => {
          data.push(chunk)
        })
      })
      const clientStream = this.clientConn.createStream()
      clientStream.write(Buffer.alloc(30000))
      clientStream.end()
      await new Promise(setImmediate)
      await new Promise(setImmediate)
      await new Promise(setImmediate)
      assert.equal(Buffer.concat(data).length, 30000)
    })

    it('should close the stream if it could send more money but the other side is blocking it', function (done) {
      const clientStream = this.clientConn.createStream()
      clientStream.setSendMax(1000)
      clientStream.end()
      clientStream.on('end', () => {
        assert.equal(clientStream.totalSent, '0')
        done()
      })
    })

    it('should reject packets that include money for streams that are already closed', async function () {
      const spy = sinon.spy()
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.end()
      })

      // Send a small amount to open the stream on the other side
      const clientStream = this.clientConn.createStream()
      clientStream.on('error', spy)
      clientStream.setSendMax(100)
      await new Promise(setImmediate)

      let responses: Buffer[] = []
      const realSendData = this.clientPlugin.sendData.bind(this.clientPlugin)
      this.clientPlugin.sendData = async (data: Buffer) => {
        const response = await realSendData(data)
        responses.push(response)
        return response
      }
      clientStream.setSendMax(100)

      await new Promise(setImmediate)
      await new Promise(setImmediate)
      await new Promise(setImmediate)

      const deserialized = IlpPacket.deserializeIlpReject(responses[0])
      assert.equal(deserialized.code, 'F99')
      const decrypted = Packet.decryptAndDeserialize(this.sharedSecret, deserialized.data)
      assert.deepInclude(decrypted.frames, new StreamCloseFrame(1, ErrorCode.NoError, ''))
    })

    it('should reject packets that include data for streams that are already closed', async function () {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.on('data', () => {})
        stream.end()
      })

      // Send a small amount to open the stream on the other side
      const clientStream = this.clientConn.createStream()
      clientStream.write('hello')
      await new Promise(setImmediate)

      let responses: Buffer[] = []
      const realSendData = this.clientPlugin.sendData.bind(this.clientPlugin)
      this.clientPlugin.sendData = async (data: Buffer) => {
        const response = await realSendData(data)
        responses.push(response)
        return response
      }
      clientStream.write('more data')
      clientStream.on('error', () => {})

      await new Promise(setImmediate)
      await new Promise(setImmediate)
      await new Promise(setImmediate)

      const deserialized = IlpPacket.deserializeIlpReject(responses[0])
      assert.equal(deserialized.code, 'F99')
      const decrypted = Packet.decryptAndDeserialize(this.sharedSecret, deserialized.data)
      assert.deepInclude(decrypted.frames, new StreamCloseFrame(1, ErrorCode.NoError, ''))
    })

    it('should not allow more data to be written once the stream is closed and throw an error if there is no error listener', async function () {
      const clientStream = this.clientConn.createStream()
      clientStream.end()
      assert.throws(() => clientStream.write('hello'), 'write after end')
    })

    it('should not allow more data to be written once the stream is closed and emit an error if error listener present', async function () {
      const clientStream = this.clientConn.createStream()
      clientStream.on('error', (err: Error) => {
        assert.equal(err.message, 'write after end')
      })
      clientStream.end()
      clientStream.write('hello')
    })

    it('should not allow more money to be sent once the stream is closed and throw an error', async function() {
      const clientStream = this.clientConn.createStream()
      await clientStream.end()
      assert.throws(() => clientStream.setSendMax(400), 'Stream already closed')
      await assert.isRejected(clientStream.sendTotal(300), 'Stream already closed')
    })

    it('should not allow more money to be sent once the stream is closed mid sending and throw an error', async function() {
      const clientStream = this.clientConn.createStream()
      clientStream.end()
      await assert.isRejected(clientStream.sendTotal(300), 'Stream was closed before the desired amount was sent (target: 300, totalSent: 0)')
    })
  })

  describe('destroy', function () {
    it('should close the stream on the other side', function (done) {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(1000)
        stream.on('end', done)
      })

      const clientStream = this.clientConn.createStream()
      clientStream.sendTotal(1000)
        .then(() => clientStream.destroy())
    })

    it('should cause the remote stream to emit the error passed in', function (done) {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(1000)
        stream.on('error', (err: Error) => {
          assert.equal(err.message, 'oops, something went wrong')
          done()
        })
      })

      const clientStream = this.clientConn.createStream()
      clientStream.on('error', (err: Error) => {
        assert.equal(err.message, 'oops, something went wrong')
      })
      clientStream.sendTotal(1000)
        .then(() => clientStream.destroy(new Error('oops, something went wrong')))
    })

    it('should close the stream even if there is money to be sent', function (done) {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.setReceiveMax(1000)
      })
      const clientStream = this.clientConn.createStream()
      clientStream.setSendMax(1000)
      clientStream.on('end', () => {
        assert.equal(clientStream.totalSent, '0')
        done()
      })
      clientStream.destroy()
    })
  })

  describe('Sending Data', function () {
    it('should be a Duplex stream', function () {
      const dataStream = this.clientConn.createStream()
      assert.instanceOf(dataStream, Duplex)
    })

    it('should send data', function (done) {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.on('data', (data: Buffer) => {
          assert.equal(data.toString(), 'hello')
          done()
        })
      })

      const clientStream = this.clientConn.createStream()
      clientStream.write('hello')
    })

    it('should accurately report the readableLength and writableLength', function (done) {
      this.serverConn.on('stream', async (stream: DataAndMoneyStream) => {
        await new Promise(setImmediate)
        assert.equal(stream.readableLength, 5)
        stream.on('data', () => {})
        done()
      })

      const clientStream = this.clientConn.createStream()
      clientStream.write('hello')
      assert.equal(clientStream.writableLength, 5)
    })

    it('should split data across multiple packets if necessary', function (done) {
      const dataToSend = Buffer.alloc(40000, 'af39', 'hex')
      const spy = sinon.spy()
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => {
          if (chunk) {
            chunks.push(chunk)
          }
        })
        stream.on('end', (chunk: Buffer) => {
          spy()
          if (chunk) {
            chunks.push(chunk)
          }
          assert(dataToSend.equals(Buffer.concat(chunks)))
          assert.callCount(spy, 1)
          done()
        })
      })
      const clientStream = this.clientConn.createStream()
      clientStream.write(dataToSend)
      clientStream.end()
    })

    it('should not send more than 32767 bytes in the packet', function (done) {
      const spy = sinon.spy(this.clientPlugin, 'sendData')
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.on('data', () => {})
        stream.on('end', (chunk: Buffer) => {
          assert.isAtMost(IlpPacket.deserializeIlpPrepare(spy.args[0][0]).data.length, 32767)
          done()
        })
      })
      const clientStream = this.clientConn.createStream()
      const dataToSend = Buffer.alloc(1000, 'af39', 'hex')
      for (let i = 0; i < 40; i++) {
        clientStream.write(dataToSend)
      }
      clientStream.end()
    })

    it('should respect the backpressure from the other side', function (done) {
      this.serverConn.on('stream', async (stream: DataAndMoneyStream) => {
        // Peer sends first chunk
        await new Promise(setImmediate)
        assert.equal(stream.readableLength, 16384)
        assert.equal(stream._getIncomingOffsets().maxAcceptable, 16384)

        // We consume some
        stream.read(3450)
        await new Promise(setImmediate)
        assert.equal(stream.readableLength, 16384 - 3450)
        await new Promise(setImmediate)

        // Now they've sent the next chunk
        assert.equal(stream.readableLength, 16384)
        assert.equal(stream._getIncomingOffsets().maxAcceptable, 16384 + 3450)
        done()
      })

      const clientStream = this.clientConn.createStream()
      const dataToSend = Buffer.alloc(1000, 'af39', 'hex')
      for (let i = 0; i < 40; i++) {
        clientStream.write(dataToSend)
      }
    })

    it('should apply backpressure to the writableStream', async function () {
      const clientStream = this.clientConn.createStream()
      assert.equal(clientStream.write(Buffer.alloc(16384)), false)
      assert.equal(clientStream.writableLength, 16384)
      await new Promise(setImmediate)

      // Now the data has been sent
      assert.equal(clientStream.writableLength, 0)
      assert.equal(clientStream.write(Buffer.alloc(16384)), false)
      assert.equal(clientStream.writableLength, 16384)
      await new Promise(setImmediate)

      // The other side isn't accepting data so it's still in the buffer on our side
      assert.equal(clientStream.writableLength, 16384)
    })

    it('should retry data sent in packets that are rejected by connectors', function (done) {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.on('data', (chunk: Buffer) => {
          assert.lengthOf(chunk, 1000)
          done()
        })
      })
      sinon.stub(this.clientPlugin, 'sendData')
        .onFirstCall()
        .resolves(IlpPacket.serializeIlpReject({
          code: 'T00',
          message: 'uh oh',
          triggeredBy: 'test.connector',
          data: Buffer.alloc(0)
        }))
        .callThrough()
      const clientStream = this.clientConn.createStream()
      clientStream.write(Buffer.alloc(1000))
    })

    it('should retry sending data from packets rejected by the receiver', function (done) {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.on('data', (chunk: Buffer) => {
          assert.lengthOf(chunk, 1000)
          done()
        })
      })
      sinon.stub(this.clientPlugin, 'sendData')
        .onFirstCall()
        .resolves(IlpPacket.serializeIlpReject({
          code: 'F99',
          message: 'uh oh',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        }))
        .callThrough()
      const clientStream = this.clientConn.createStream()
      clientStream.write(Buffer.alloc(1000))
    })

    it('should order data correctly if packets are rejected and data must be resent', function (done) {
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        stream.on('end', () => {
          const data = Buffer.concat(chunks)
          for (let i = 0; i < 40; i++) {
            assert.equal(data[i * 1000], i)
          }
          done()
        })
      })
      sinon.stub(this.clientPlugin, 'sendData')
        .onFirstCall()
        .resolves(IlpPacket.serializeIlpReject({
          code: 'F99',
          message: 'uh oh',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        }))
        .callThrough()
      const clientStream = this.clientConn.createStream()
      for (let i = 0; i < 40; i++) {
        clientStream.write(Buffer.alloc(1000, i))
      }
      clientStream.end()
    })

    it('should correctly order data received out of order', async function () {
      const spy = sinon.spy()
      const clientStream = this.clientConn.createStream()
      clientStream.on('data', spy)

      clientStream._pushIncomingData(Buffer.alloc(200, 2), 100)
      clientStream._pushIncomingData(Buffer.alloc(5, 5), 601) // this one won't be emitted
      clientStream._pushIncomingData(Buffer.alloc(300, 3), 300)
      assert.notCalled(spy)

      assert.equal(clientStream.readableLength, 0)
      assert.deepEqual(clientStream._getIncomingOffsets(), {
        max: 606,
        current: 0,
        maxAcceptable: 16384
      })

      clientStream._pushIncomingData(Buffer.alloc(100, 1), 0)

      assert.equal(clientStream.readableLength, 600)

      await new Promise(setImmediate)

      assert.callCount(spy, 3)
      assert.calledWith(spy.firstCall, Buffer.alloc(100, 1))
      assert.calledWith(spy.secondCall, Buffer.alloc(200, 2))
      assert.calledWith(spy.thirdCall, Buffer.alloc(300, 3))

      assert.deepEqual(clientStream._getIncomingOffsets(), {
        max: 606,
        current: 600,
        maxAcceptable: 16384 + 600
      })
    })
  })

  describe('Control Frames', function() {
    it('should retry StreamCloseFrame when rejected by connector', function(done) {
      const serverEndSpy = sinon.spy()
      const clientEndSpy = sinon.spy()
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.on('end', () => {
          serverEndSpy()
          assert.calledOnce(clientEndSpy)
          assert.calledOnce(serverEndSpy)
          done()
        })
      })
      const clientStream = this.clientConn.createStream()
      clientStream.on('end', clientEndSpy)

      // Allow the write through on first call, reject second to block Close Frame
      sinon.stub(this.clientPlugin, 'sendData')
        .onSecondCall()
        .resolves(IlpPacket.serializeIlpReject({
          code: 'T00',
          message: 'uh oh',
          triggeredBy: 'test.connector',
          data: Buffer.alloc(0)
        }))
        .callThrough()
      clientStream.end('hello')
    })

    it('should retry StreamCloseFrame when rejected by receiver', function (done) {
      const serverEndSpy = sinon.spy()
      const clientEndSpy = sinon.spy()
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.on('end', () => {
          serverEndSpy()
          assert.calledOnce(clientEndSpy)
          assert.calledOnce(serverEndSpy)
          done()
        })
      })
      const clientStream = this.clientConn.createStream()
      clientStream.on('end', clientEndSpy)

      // Allow the write through on first call, reject second to block Close Frame
      sinon.stub(this.clientPlugin, 'sendData')
        .onSecondCall()
        .resolves(IlpPacket.serializeIlpReject({
          code: 'F99',
          message: 'uh oh',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        }))
        .callThrough()
      clientStream.end('hello')
    })

    it('should retry StreamCloseFrame when rejected multiple times by receiver', function(done) {
      const serverEndSpy = sinon.spy()
      const clientEndSpy = sinon.spy()
      this.serverConn.on('stream', (stream: DataAndMoneyStream) => {
        stream.on('end', () => {
          serverEndSpy()
          assert.calledOnce(clientEndSpy)
          assert.calledOnce(serverEndSpy)
          done()
        })
      })
      const clientStream = this.clientConn.createStream()
      clientStream.on('end', clientEndSpy)

      // Allow the write through on first call, reject second to block Close Frame
      sinon.stub(this.clientPlugin, 'sendData')
        .onSecondCall()
        .resolves(IlpPacket.serializeIlpReject({
          code: 'F99',
          message: 'uh oh',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        }))
        .onThirdCall()
        .resolves(IlpPacket.serializeIlpReject({
          code: 'F99',
          message: 'second rejection',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        }))
        .callThrough()
      clientStream.end('hello')
    })
  })
})
