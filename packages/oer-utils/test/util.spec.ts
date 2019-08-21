import * as util from '../src/lib/util'
import * as Long from 'long'

import chai = require('chai')
const assert = chai.assert

describe('util', function () {
  describe('isInteger', function () {
    it('validates integral numbers', function () {
      assert.strictEqual(util.isInteger(123), true)
      assert.strictEqual(util.isInteger(0), true)
      assert.strictEqual(util.isInteger(-123), true)

      assert.strictEqual(util.isInteger(Infinity), false)
      assert.strictEqual(util.isInteger(NaN), false)
      assert.strictEqual(util.isInteger(1.5), false)
    })

    it('validates strings', function () {
      assert.strictEqual(util.isInteger('123'), true)
      assert.strictEqual(util.isInteger('-123'), true)
      assert.strictEqual(util.isInteger('0'), true)

      assert.strictEqual(util.isInteger('--123'), false)
      assert.strictEqual(util.isInteger('1.5'), false)
      assert.strictEqual(util.isInteger('foo'), false)
      assert.strictEqual(util.isInteger('123 '), false)
    })

    it('validates Longs', function () {
      assert.strictEqual(util.isInteger(Long.fromNumber(123, false)), true)
      assert.strictEqual(util.isInteger(Long.fromNumber(123, true)), true)

      assert.strictEqual(util.isInteger({ low: 12, high: 34, unsigned: true }), false)
    })
  })

  describe('longFromValue', function () {
    it('throws when getting an unsigned Long from a negative Number', function () {
      assert.throws(function () {
        util.longFromValue(-123, true)
      }, 'UInt must be positive')
    })

    it('throws when getting an unsigned Long from a negative string number', function () {
      assert.throws(function () {
        util.longFromValue('-123', true)
      }, 'UInt must be positive')
    })

    it('throws when the Long has the wrong signed-ness', function () {
      assert.throws(function () {
        util.longFromValue(Long.fromNumber(5, false), true)
      }, 'Expected unsigned Long')
      assert.throws(function () {
        util.longFromValue(Long.fromNumber(5, true), false)
      }, 'Expected signed Long')
    })
  })

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

    it('throws when the buffer is too large', function () {
      assert.throws(function () {
        util.bufferToLong(Buffer.alloc(9), true)
      }, 'UInt of length 9 is too large')
    })
  })
})

function randomNumber (unsigned: boolean): number {
  const max = 0x7fffffffffff
  let value = Math.floor(max * Math.random())
  if (unsigned && Math.random() < 0.5) value = -value
  return value
}
