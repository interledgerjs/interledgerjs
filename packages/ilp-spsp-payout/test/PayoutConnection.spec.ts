import 'mocha'
import { PayoutConnection } from '../src/lib/PayoutConnection'
import * as sinon from 'sinon'
import * as Chai from 'chai'
const assert = Object.assign(Chai.assert, sinon.assert)
require('source-map-support').install()

describe('PayoutConnection', function () {
  describe('close', function () {
    // If the timeout isn't cleaned up, this test will pass --
    // but the test runner will not exit.
    it("doesn't create a timeout when closed", function () {
      const payer = new PayoutConnection({
        // send() will fail because no-one is listening
        pointer: 'http://127.0.0.1:54321',
        plugin: { disconnect: () => {} },
      })
      payer.send(123)
      payer.close()
    })

    it('cleans up the timeout', async function () {
      const payer = new PayoutConnection({
        // send() will fail because no-one is listening
        pointer: 'http://127.0.0.1:54321',
        plugin: { disconnect: () => {} },
      })
      payer.send(123)
      await new Promise((resolve) => setTimeout(resolve, 10))
      payer.close()
    })
  })
})
