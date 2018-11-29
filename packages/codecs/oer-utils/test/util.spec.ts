import * as util from '../src/lib/util'
import BigNumber from 'bignumber.js'

import chai = require('chai')
const assert = chai.assert

describe('util', function () {
  describe('getUIntBufferSize', function () {
    it('returns the same values as getBigUIntBufferSize', function () {
      const max = 0x7fffffffffff
      for (let i = 0; i < 1000; i++) {
        const value = Math.floor(max * Math.random())
        const numBuf = util.getUIntBufferSize(value)
        const bigBuf = util.getBigUIntBufferSize(new BigNumber(value))
        assert.equal(numBuf, bigBuf, 'mismatch for value=' + value)
      }
    })
  })

  describe('getIntBufferSize', function () {
    it('returns the same values as getBigIntBufferSize', function () {
      const max = 0x7fffffffffff
      for (let i = 0; i < 1000; i++) {
        let value = Math.floor(max * Math.random())
        if (Math.random() < 0.5) value = -value

        const numBuf = util.getIntBufferSize(value)
        const bigBuf = util.getBigIntBufferSize(new BigNumber(value))
        assert.equal(numBuf, bigBuf, 'mismatch for value=' + value)
      }
    })
  })
})
