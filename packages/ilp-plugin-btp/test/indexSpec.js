'use strict'

const assert = require('assert')
const BtpPlugin = require('..')

describe('constructor', function () {
  beforeEach(async function () {
    this.server = new BtpPlugin({
      listener: {
        port: 9000,
        secret: 'secret'
      }
    })
    this.client = new BtpPlugin({
      server: 'btp+ws://:secret@localhost:9000',
      reconnectInterval: 100
    })
  })

  afterEach(async function () {
    await this.client.disconnect()
    await this.server.disconnect()
  })

  describe('connect', function () {
    it('connects the client and server', async function () {
      await Promise.all([
        this.server.connect(),
        this.client.connect()
      ])
      assert.strictEqual(this.server.isConnected(), true)
      assert.strictEqual(this.client.isConnected(), true)

      this.server.registerDataHandler((ilp) => {
        assert.deepEqual(ilp, Buffer.from('foo'))
        return Buffer.from('bar')
      })

      const response = await this.client.sendData(Buffer.from('foo'))
      assert.deepEqual(response, Buffer.from('bar'))
    })

    it('client retries if first connect fails', async function () {
      const p1 = this.client.connect()
      await new Promise((resolve) => setTimeout(resolve, 10))
      const p2 = this.server.connect()
      await Promise.all([p1, p2])

      assert.strictEqual(this.server.isConnected(), true)
      assert.strictEqual(this.client.isConnected(), true)
    })
  })
})
