import 'mocha'
import { Payout } from '../src'
import * as sinon from 'sinon'
import * as Chai from 'chai'
const assert = Object.assign(Chai.assert, sinon.assert)
require('source-map-support').install()

describe('ilp-spsp-payout', function () {
  describe('Initializing Payout', function () {
    it('should return an instance of Payout', function () {
      const payer = new Payout()
      assert.instanceOf(payer, Payout)
    })
  })
})
