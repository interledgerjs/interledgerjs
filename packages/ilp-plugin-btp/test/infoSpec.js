'use strict'

const btpPacket = require('btp-packet')
const assert = require('chai').assert

const ObjStore = require('./helpers/objStore')
const PluginPaymentChannel = require('..')
const MockSocket = require('./helpers/mockSocket')
const { protocolDataToIlpAndCustom } =
  require('../src/util/protocolDataConverter')

const info = {
  currencyScale: 2,
  currencyCode: 'USD',
  connectors: [ { id: 'other', name: 'other', connector: 'peer.usd.other' } ]
}

const options = {
  prefix: 'example.red.',
  maxBalance: '1000000',
  server: 'btp+wss://user:placeholder@example.com/rpc',
  info: info,
  incomingSecret: 'placeholder'
}

describe('Info', () => {
  beforeEach(async function () {
    options._store = new ObjStore()
    this.plugin = new PluginPaymentChannel(options)

    this.mockSocketIndex = 0
    this.mockSocket = new MockSocket()
    this.mockSocket
      .reply(btpPacket.TYPE_MESSAGE, ({ requestId }) => btpPacket.serializeResponse(requestId, []))

    await this.plugin.addSocket(this.mockSocket, { username: 'user', token: 'placeholder' })
    await this.plugin.connect()
  })

  afterEach(async function () {
    assert(await this.mockSocket.isDone(), 'request handlers must have been called')
  })

  describe('getBalance', () => {
    it('should start at zero', function * () {
      assert.equal((yield this.plugin.getBalance()), '0')
    })
  })

  describe('getLimit', () => {
    it('return the result of the RPC call', function * () {
      this.mockSocket.reply(btpPacket.TYPE_MESSAGE, ({requestId, data}) => {
        const expectedGetLimitRequest = {
          protocolData: [{
            protocolName: 'limit',
            contentType: btpPacket.MIME_APPLICATION_OCTET_STREAM,
            data: Buffer.from([ 0 ])
          }]
        }
        assert.deepEqual(data, expectedGetLimitRequest)

        return btpPacket.serializeResponse(requestId, [{
          protocolName: 'limit',
          contentType: btpPacket.MIME_APPLICATION_JSON,
          data: Buffer.from(JSON.stringify('5'))
        }])
      })

      // the value is reversed so it makes sense to our side
      assert.equal((yield this.plugin.getLimit()), '-5')
    })

    it('handles getLimit requests', function * () {
      this.mockSocket.reply(btpPacket.TYPE_RESPONSE, ({requestId, data}) => {
        const {protocolMap} = protocolDataToIlpAndCustom(data)
        assert(protocolMap.limit)
        assert(protocolMap.limit, options.maxBalance)
      })

      const getLimitReq = btpPacket.serializeMessage(12345, [{
        protocolName: 'limit',
        contentType: btpPacket.MIME_APPLICATION_JSON,
        data: Buffer.from('[]')
      }])
      this.mockSocket.emit('message', getLimitReq)
    })
  })

  describe('getPeerBalance', () => {
    it('return the result of the RPC call', function * () {
      this.mockSocket.reply(btpPacket.TYPE_MESSAGE, ({requestId, data}) => {
        const expectedGetBalanceRequest = {
          protocolData: [{
            protocolName: 'balance',
            contentType: btpPacket.MIME_APPLICATION_OCTET_STREAM,
            data: Buffer.from([ 0 ])
          }]
        }
        assert.deepEqual(data, expectedGetBalanceRequest)

        return btpPacket.serializeResponse(requestId, [{
          protocolName: 'balance',
          contentType: btpPacket.MIME_APPLICATION_JSON,
          data: Buffer.from(JSON.stringify('5'))
        }])
      })

      // the value is reversed so it makes sense to our side
      assert.equal((yield this.plugin.getPeerBalance()), '-5')
    })
  })

  describe('getInfo', () => {
    it('should use the supplied info', function () {
      assert.deepEqual(
        this.plugin.getInfo(),
        Object.assign({}, info, {prefix: this.plugin.getInfo().prefix})
      )
    })

    it('should return the full info', function () {
      const expectedFullInfo = Object.assign({},
        info,
        {prefix: this.plugin.getInfo().prefix}
      )
      this.mockSocket.reply(btpPacket.TYPE_RESPONSE, ({data}) => {
        const resp = protocolDataToIlpAndCustom(data)
        assert.property(resp.protocolMap, 'info')
        assert.deepEqual(resp.protocolMap.info, expectedFullInfo)
      })

      const fullInfoReq = btpPacket.serializeMessage(12345, [{
        protocolName: 'info',
        contentType: btpPacket.MIME_APPLICATION_OCTET_STREAM,
        data: Buffer.from([ 2 ]) // 2 == INFO_REQUEST_FULL
      }])
      this.mockSocket.emit('message', fullInfoReq)
    })
  })

  describe('isAuthorized', () => {
    it('should authorize its own auth token', function () {
      assert.isTrue(this.plugin.isAuthorized(this.plugin._getAuthToken()))
    })

    it('should not authorize any other token', function () {
      assert.isFalse(this.plugin.isAuthorized('any other token'))
    })
  })

  describe('authentication', () => {
    beforeEach(async function () {
      this.newSocket = new MockSocket()
      this.plugin.addSocket(this.newSocket)
    })

    afterEach(async function () {
      assert(await this.newSocket.isDone(), 'request handlers must be complete')
    })

    it('should deny an authentication request with wrong method', async function () {
      this.newSocket.emit('message', btpPacket.serializeFulfill({
        transferId: 'b38a5203-bdb8-f11f-db01-5a32cf1a4e43',
        fulfillment: 'Ndr_HMuLPPl0idUlvAXFXBVQTFOizq-nXozej0KIA7k'
      }, 100, []))

      this.newSocket.reply(btpPacket.TYPE_ERROR, e => {
        assert.equal(e.requestId, 100)
        assert.equal(e.data.code, 'F01')
        assert.equal(e.data.name, 'InvalidFieldsError')
        assert.equal(e.data.data, '{"message":"invalid method on unauthenticated socket"}')
      })
    })

    it('should deny an authentication request with no "auth" protocol', async function () {
      this.newSocket.emit('message', btpPacket.serializeMessage(100, []))

      this.newSocket.reply(btpPacket.TYPE_ERROR, e => {
        assert.equal(e.requestId, 100)
        assert.equal(e.data.code, 'F01')
        assert.equal(e.data.name, 'InvalidFieldsError')
        assert.equal(e.data.data, '{"message":"auth must be primary protocol on unauthenticated message"}')
      })
    })

    it('should deny an authentication request with no "auth_token" protocol', async function () {
      this.newSocket.emit('message', btpPacket.serializeMessage(100, [{
        protocolName: 'auth',
        contentType: btpPacket.MIME_APPLICATION_OCTET_STREAM,
        data: Buffer.from('')
      }]))

      this.newSocket.reply(btpPacket.TYPE_ERROR, e => {
        assert.equal(e.requestId, 100)
        assert.equal(e.data.code, 'F01')
        assert.equal(e.data.name, 'InvalidFieldsError')
        assert.equal(e.data.data, '{"message":"missing \\"auth_token\\" secondary protocol"}')
      })
    })

    it('should deny an authentication request with no "auth_username" protocol', async function () {
      this.newSocket.emit('message', btpPacket.serializeMessage(100, [{
        protocolName: 'auth',
        contentType: btpPacket.MIME_APPLICATION_OCTET_STREAM,
        data: Buffer.from('')
      }, {
        protocolName: 'auth_token',
        contentType: btpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from('')
      }]))

      this.newSocket.reply(btpPacket.TYPE_ERROR, e => {
        assert.equal(e.requestId, 100)
        assert.equal(e.data.code, 'F01')
        assert.equal(e.data.name, 'InvalidFieldsError')
        assert.equal(e.data.data, '{"message":"missing \\"auth_username\\" secondary protocol"}')
      })
    })

    it('should deny an authentication request with invalid token', async function () {
      this.newSocket.emit('message', btpPacket.serializeMessage(100, [{
        protocolName: 'auth',
        contentType: btpPacket.MIME_APPLICATION_OCTET_STREAM,
        data: Buffer.from('')
      }, {
        protocolName: 'auth_token',
        contentType: btpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from('garbage')
      }, {
        protocolName: 'auth_username',
        contentType: btpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from('')
      }]))

      this.newSocket.reply(btpPacket.TYPE_ERROR, e => {
        assert.equal(e.requestId, 100)
        assert.equal(e.data.code, 'F00')
        assert.equal(e.data.name, 'NotAcceptedError')
        assert.equal(e.data.data, '{"message":"invalid auth token and/or username"}')
      })
    })

    it('should accept an authentication request with valid credentials', async function () {
      this.newSocket.emit('message', btpPacket.serializeMessage(100, [{
        protocolName: 'auth',
        contentType: btpPacket.MIME_APPLICATION_OCTET_STREAM,
        data: Buffer.from('')
      }, {
        protocolName: 'auth_token',
        contentType: btpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from('placeholder')
      }, {
        protocolName: 'auth_username',
        contentType: btpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from('')
      }]))

      this.newSocket.reply(btpPacket.TYPE_RESPONSE, r => {
        assert.equal(r.requestId, 100)
      })
    })
  })

  describe('disconnect', () => {
    it('should disconnect when connected', function * () {
      assert.isTrue(this.plugin.isConnected(), 'should have connected before')
      yield this.plugin.disconnect()
      assert.isFalse(this.plugin.isConnected(), 'shouldn\'t be connected after disconnect')
    })

    it('should stay disconnected when disconnected', function * () {
      yield this.plugin.disconnect()
      yield this.plugin.disconnect()
      assert.isFalse(this.plugin.isConnected(), 'still should be disconnected after second disconnect')
    })

    it('should reconnect', function * () {
      yield this.plugin.disconnect()
      yield this.plugin.connect()
      assert.isTrue(this.plugin.isConnected(), 'should have reconnected')
    })
  })
})
