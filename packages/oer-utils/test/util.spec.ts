import * as util from '../src/lib/util'
import * as Long from 'long'

import chai = require('chai')
const assert = chai.assert

describe('util', function () {
  describe('getUIntBufferSize', function () {
    it('returns the same values as getLongUIntBufferSize', function () {
      for (let i = 0; i < 1000; i++) {
        const value = randomNumber(true)
        const numBuf = util.getUIntBufferSize(value)
        const longBuf = util.getLongUIntBufferSize(Long.fromNumber(value, true))
        assert.equal(numBuf, longBuf, 'mismatch for value=' + value)
      }
    })
  })

  describe('getIntBufferSize', function () {
    it('returns the same values as getLongIntBufferSize', function () {
      for (let i = 0; i < 1000; i++) {
        const value = randomNumber(false)
        const numBuf = util.getIntBufferSize(value)
        const longBuf = util.getLongIntBufferSize(Long.fromNumber(value, false))
        assert.equal(numBuf, longBuf, 'mismatch for value=' + value)
      }
    })
  })

  describe('bufferToLong', function () {
    [
      { name: 'unsigned', unsigned: true },
      { name: 'signed', unsigned: false }
    ].forEach(function ({ name, unsigned }) {
      describe(name, function () {
        for (let i = 0; i < 1000; i++) {
          const value = randomNumber(unsigned)
          const longValue = Long.fromNumber(value, unsigned)
          const buffer = util.longToBuffer(longValue, 8)
          assert.deepEqual(util.bufferToLong(buffer, unsigned), longValue)
        }
      })
    })
  })
})

function randomNumber (unsigned: boolean): number {
  const max = 0x7fffffffffff
  let value = Math.floor(max * Math.random())
  if (unsigned && Math.random() < 0.5) value = -value
  return value
}
