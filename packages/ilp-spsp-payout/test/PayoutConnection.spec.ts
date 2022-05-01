import 'mocha'
import { PayoutConnection } from '../src/lib/PayoutConnection'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import { Plugin } from 'ilp-plugin'
const assert = Object.assign(Chai.assert, sinon.assert)

const noop = () => Promise.resolve()

describe('PayoutConnection', function () {
  describe('close', function () {
    // If the timeout isn't cleaned up, this test will pass --
    // but the test runner will not exit.
    it("doesn't create a timeout when closed", function () {
      const payer = new PayoutConnection({
        // send() will fail because no-one is listening
        pointer: 'http://127.0.0.1:54321',
        plugin: { disconnect: noop } as Plugin,
        retryInterval: 10,
        maxRetries: 5,
      })
      payer.send(123)
      payer.close()
    })

    it('cleans up the timeout', async function () {
      const payer = new PayoutConnection({
        // send() will fail because no-one is listening
        pointer: 'http://127.0.0.1:54321',
        plugin: { disconnect: noop } as Plugin,
        retryInterval: 10,
        maxRetries: 5,
      })
      payer.send(123)
      await new Promise((resolve) => setTimeout(resolve, 10))
      payer.close()
    })
  })

  describe('isIdle', function () {
    it('becomes idle after maxRetries', async function () {
      const payer = new PayoutConnection({
        // send() will fail because no-one is listening
        pointer: 'http://127.0.0.1:54321',
        plugin: { disconnect: noop } as Plugin,
        retryInterval: 10,
        maxRetries: 5,
      })

      payer.send(123)
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(payer.isIdle(), true)
      // @ts-expect-error Retries is a private field
      assert.equal(payer.retries, 6)
    })
  })
})
