import * as ILDCP from '../src'
import * as IlpPacket from 'ilp-packet'
import chai = require('chai')
import chaiAsPromised = require('chai-as-promised')
import sinon = require('sinon')

chai.use(chaiAsPromised)
const assert = chai.assert

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const sinonMatchBuffer = (expectationHex: string) => (
  sinon.match.instanceOf(Buffer)
    .and(sinon.match((val: Buffer) => val.toString('hex') === expectationHex))
)

describe('ILDCP', function () {
  beforeEach(function () {
    this.clock = sinon.useFakeTimers(START_DATE)
  })

  describe('deserializeIldcpRequest', async function () {
    it('should be a function', async function () {
      assert.isFunction(ILDCP.deserializeIldcpRequest)
    })

    it('should deserialize an IL-DCP request', async function () {
      const request = Buffer.from('0c460000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f29250b706565722e636f6e66696700', 'hex')

      assert.deepEqual(ILDCP.deserializeIldcpRequest(request), {})
    })

    it('should fail to parse an IL-DCP request with the wrong destination', async function () {
      const request = Buffer.from('0c460000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f29250b706565722e626f6e66696700', 'hex')

      assert.throws(() => ILDCP.deserializeIldcpRequest(request), 'packet is not an IL-DCP request.')
    })

    it('should fail to parse an IL-DCP request with the wrong condition', async function () {
      const request = Buffer.from('0c460000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e30089714856ee233b3902a591d0d5f29250b706565722e636f6e66696700', 'hex')

      assert.throws(() => ILDCP.deserializeIldcpRequest(request), 'packet does not contain correct condition for a peer protocol request.')
    })

    it('should fail to parse an expired IL-DCP request', async function () {
      const request = Buffer.from('0c460000000000000000323031343036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f29250b706565722e636f6e66696700', 'hex')

      assert.throws(() => ILDCP.deserializeIldcpRequest(request), 'IL-DCP request packet is expired.')
    })
  })

  describe('serializeIldcpRequest', async function () {
    it('should be a function', async function () {
      assert.isFunction(ILDCP.serializeIldcpRequest)
    })

    it('should serialize an IL-DCP request', async function () {
      assert.equal(ILDCP.serializeIldcpRequest({}).toString('hex'), '0c460000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f29250b706565722e636f6e66696700')
    })
  })

  describe('deserializeIldcpResponse', async function () {
    it('should be a function', async function () {
      assert.isFunction(ILDCP.deserializeIldcpResponse)
    })

    it('should deserialize an IL-DCP response', async function () {
      const response = Buffer.from('0d350000000000000000000000000000000000000000000000000000000000000000140e6578616d706c652e636c69656e740d0358414d', 'hex')

      assert.deepEqual(ILDCP.deserializeIldcpResponse(response), {
        clientAddress: 'example.client',
        assetScale: 13,
        assetCode: 'XAM'
      })
    })

    it('should fail if the response contains the wrong fulfillment', async function () {
      const request = Buffer.from('0d350000000000000000000000000000100000000000000000000000000000000000140e6578616d706c652e636c69656e740d0358414d', 'hex')

      assert.throws(() => ILDCP.deserializeIldcpResponse(request), 'IL-DCP response does not contain the expected fulfillment.')
    })
  })

  describe('serializeIldcpResponse', async function () {
    it('should be a function', async function () {
      assert.isFunction(ILDCP.serializeIldcpResponse)
    })

    it('should serialize an IL-DCP response', async function () {
      assert.equal(ILDCP.serializeIldcpResponse({
        clientAddress: 'example.client',
        assetScale: 13,
        assetCode: 'XAM'
      }).toString('hex'), '0d350000000000000000000000000000000000000000000000000000000000000000140e6578616d706c652e636c69656e740d0358414d')
    })
  })

  describe('fetch', function () {
    it('should be a function', async function () {
      assert.isFunction(ILDCP.fetch)
    })

    it('should obtain ildcp information', async function () {
      const sendData = sinon.stub()
        .withArgs(sinon.match.instanceOf(Buffer))
        .resolves(Buffer.from('0d350000000000000000000000000000000000000000000000000000000000000000140e6578616d706c652e636c69656e740d0358414d', 'hex'))

      const response = await ILDCP.fetch(sendData)

      assert.deepEqual(response, {
        clientAddress: 'example.client',
        assetScale: 13,
        assetCode: 'XAM'
      })
      sinon.assert.calledOnce(sendData)
      sinon.assert.calledWithExactly(sendData, sinonMatchBuffer('0c460000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f29250b706565722e636f6e66696700'))
    })

    it('should throw if the request is rejected', async function () {
      const rejection = IlpPacket.serializeIlpReject({
        code: 'F00',
        triggeredBy: 'example.server',
        message: 'something went wrong.',
        data: Buffer.alloc(0)
      })
      const sendData = sinon.stub()
        .withArgs(sinon.match.instanceOf(Buffer))
        .resolves(rejection)

      assert.isRejected(
        ILDCP.fetch(sendData),
        'IL-DCP failed: something went wrong.'
      )
    })

    it('should throw if the response type is unrecognized', async function () {
      const sendData = sinon.stub()
        .withArgs(sinon.match.instanceOf(Buffer))
        .resolves(Buffer.from('89', 'hex'))

      assert.isRejected(
        ILDCP.fetch(sendData),
        'IL-DCP error, unable to retrieve client configuration.'
      )
    })
  })

  describe('serve', function () {
    it('should be a function', async function () {
      assert.isFunction(ILDCP.serve)
    })

    it('should return an IL-DCP response', async function () {
      const handler = sinon.stub()
        .resolves({
          clientAddress: 'example.client',
          assetScale: 13,
          assetCode: 'XAM'
        })
      const response = await ILDCP.serve({
        requestPacket: Buffer.from('0c460000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f29250b706565722e636f6e66696700', 'hex'),
        handler,
        serverAddress: 'example.server'
      })

      assert.equal(response.toString('hex'), '0d350000000000000000000000000000000000000000000000000000000000000000140e6578616d706c652e636c69656e740d0358414d')
      sinon.assert.calledOnce(handler)
      sinon.assert.calledWithExactly(handler, {})
    })

    it('should return a rejection if handler rejects', async function () {
      const handler = sinon.stub()
        .rejects(new Error('something bad occurred in the neighborhood.'))
      const response = await ILDCP.serve({
        requestPacket: Buffer.from('0c460000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f29250b706565722e636f6e66696700', 'hex'),
        handler,
        serverAddress: 'example.server'
      })

      assert.equal(response.toString('hex'), '0e3f4630300e6578616d706c652e7365727665722b736f6d657468696e6720626164206f6363757272656420696e20746865206e65696768626f72686f6f642e00')
      sinon.assert.calledOnce(handler)
      sinon.assert.calledWithExactly(handler, {})
    })

    it('should return a rejection if handler rejects with a non-object', async function () {
      const handler = sinon.stub()
        .rejects(1337)
      const response = await ILDCP.serve({
        requestPacket: Buffer.from('0c460000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f29250b706565722e636f6e66696700', 'hex'),
        handler,
        serverAddress: 'example.server'
      })

      assert.equal(response.toString('hex'), '0e254630300e6578616d706c652e73657276657211756e6578706563746564206572726f722e00')
      sinon.assert.calledOnce(handler)
      sinon.assert.calledWithExactly(handler, {})
    })
  })
})
