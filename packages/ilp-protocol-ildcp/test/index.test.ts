import * as ILDCP from '../src'
import { assert } from 'chai'
import sinon = require('sinon')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

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
})
