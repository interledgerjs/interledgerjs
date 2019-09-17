import 'mocha'
import * as assert from 'assert'
import BigNumber from 'bignumber.js'
import * as Long from 'long'
import {
  longFromValue,
  maxLong,
  minLong,
  minLongs,
  countDigits,
  checkedAdd,
  checkedSubtract,
  checkedMultiply,
  multiplyDivideFloor,
  multiplyDivideCeil,
  multiplyDivideRound,
  multiplyDivide
} from '../../src/util/long'

function L (value: number, unsigned?: boolean): Long {
  return Long.fromNumber(value, unsigned === undefined ? true : unsigned)
}

// The number of times to repeat each randomized test.
const REPS = 10000

describe('util/long', function () {
  describe('longFromValue', function () {
    it('creates a Long from a number', function () {
      assert.deepEqual(longFromValue(123, true), L(123))
    })

    it('creates a Long from a string', function () {
      assert.deepEqual(longFromValue('123', true), L(123))
    })

    it('creates a Long from a Long', function () {
      assert.deepEqual(longFromValue(L(123), true), L(123))
    })

    it('throws when creating an unsigned Long from a negative number', function () {
      assert.throws(
        () => longFromValue(-123, true),
        /Expected positive number/
      )
    })

    it('throws when creating an unsigned Long from a negative string', function () {
      assert.throws(
        () => longFromValue('-123', true),
        /Expected positive number/
      )
    })

    it('throws when creating a Long from a too-large string', function () {
      assert.throws(
        () => longFromValue('18446744073709551616', true),
        /Value 18446744073709551616 does not fit in a Long\./
      )
    })
  })

  describe('minLong', function () {
    it('returns the smaller value', function () {
      assert.deepEqual(minLong(L(1), L(2)), L(1))
      assert.deepEqual(minLong(L(2), L(1)), L(1))
    })
  })

  describe('maxLong', function () {
    it('returns the larget value', function () {
      assert.deepEqual(maxLong(L(1), L(2)), L(2))
      assert.deepEqual(maxLong(L(2), L(1)), L(2))
    })
  })

  describe('minLongs', function () {
    it('returns the smallest value', function () {
      assert.deepEqual(minLongs([L(2)]), L(2))
      assert.deepEqual(minLongs([L(2), L(3)]), L(2))
      assert.deepEqual(minLongs([L(2), L(3), L(1)]), L(1))
    })
  })

  describe('countDigits', function () {
    it('returns the number of digits', function () {
      assert.equal(countDigits(L(0)), 0)
      assert.equal(countDigits(L(1)), 1)
      assert.equal(countDigits(L(12)), 2)
      assert.equal(countDigits(L(99999999)), 8)
      assert.equal(countDigits(L(100000000)), 9)
    })
  })

  describe('checkedAdd', function () {
    it('returns the sum and whether a+b overflows', function () {
      assert.deepEqual(
        checkedAdd(L(123), L(456)),
        {
          sum: L(123+456),
          overflow: false
        }
      )
      assert.deepEqual(
        checkedAdd(Long.MAX_UNSIGNED_VALUE, L(2)),
        {
          sum: Long.MAX_UNSIGNED_VALUE,
          overflow: true
        }
      )
    })
  })

  describe('checkedSubtract', function () {
    it('returns the difference and whether a-b underflows', function () {
      assert.deepEqual(
        checkedSubtract(L(2), L(1)),
        {
          difference: L(1),
          underflow: false
        }
      )
      assert.deepEqual(
        checkedSubtract(L(1), L(2)),
        {
          difference: L(0),
          underflow: true
        }
      )
    })
  })

  describe('checkedMultiply', function () {
    it('returns the product and whether a*b overflows', function () {
      assert.deepEqual(
        checkedMultiply(L(2), L(3)),
        {
          product: L(6),
          overflow: false
        }
      )
      assert.deepEqual(
        checkedMultiply(Long.MAX_UNSIGNED_VALUE, L(2)),
        {
          product: Long.MAX_UNSIGNED_VALUE,
          overflow: true
        }
      )
    })
  })

  describe('multiplyDivideFloor', function () {
    it('is equivalent to a*b/c', function () {
      for (let i = 0; i < REPS; i++) {
        const a = Math.floor(Math.random() * 1.0e8)
        const b = Math.floor(Math.random() * 1.0e8)
        const c = Math.floor(Math.random() * 1.0e8)

        const expect = new BigNumber(a)
          .times(b)
          .div(c)
          .integerValue(BigNumber.ROUND_FLOOR)
        const result = multiplyDivideFloor(L(a), L(b), L(c))

        assert.equal(
          result.toString(), expect.toString(),
          `attempt ${i}: ${result} != ${expect} = (${a}*${b}/${c})`
        )
      }
    })

    it('returns 0 when a=0', function () {
      assert(
        multiplyDivideFloor(L(0), L(123), L(123))
          .equals(Long.UZERO)
      )
    })

    it('returns 0 when b=0', function () {
      assert(
        multiplyDivideFloor(L(123), L(0), L(123))
          .equals(Long.UZERO)
      )
    })

    it('returns Long.MAX_UNSIGNED_VALUE the result overflows', function () {
      assert(
        multiplyDivideFloor(Long.MAX_UNSIGNED_VALUE.divide(2), L(3), L(1))
          .equals(Long.MAX_UNSIGNED_VALUE)
      )
    })
  })

  describe('multiplyDivideCeil', function () {
    it('rounds up', function () {
      assert(
        multiplyDivideCeil(L(2), L(3), L(100))
          .equals(L(1))
      )
      assert(
        multiplyDivideCeil(L(3), L(5), L(4))
          .equals(L(4))
      )
    })

    it('returns 0 when a or b is 0', function () {
      assert(
        multiplyDivideCeil(L(0), L(123), L(123))
          .equals(Long.UZERO)
      )
      assert(
        multiplyDivideCeil(L(123), L(0), L(123))
          .equals(Long.UZERO)
      )
      assert(
        multiplyDivideCeil(L(0), L(0), L(123))
          .equals(Long.UZERO)
      )
    })

    it('returns Long.MAX_UNSIGNED_VALUE if the result overflows', function () {
      assert(
        multiplyDivideCeil(Long.MAX_UNSIGNED_VALUE.divide(2), L(3), L(1))
          .equals(Long.MAX_UNSIGNED_VALUE)
      )
    })
  })

  describe('multiplyDivideRound', function () {
    it('returns the rounded result', function () {
      // Integer result (no round).
      assert.deepEqual(
        multiplyDivideRound(L(3), L(4), L(6)),
        L(2)
      )
      // Round down: 3*5/7 = 2.1428… ≅ 2
      assert.deepEqual(
        multiplyDivideRound(L(3), L(5), L(7)),
        L(2)
      )
      // Round up: 3*5/6 = 2.5 ≅ 3
      assert.deepEqual(
        multiplyDivideRound(L(3), L(5), L(6)),
        L(3)
      )
      // Round down (odd denominator): 2*5/3 = 3.3333… ≅ 3.
      assert.deepEqual(
        multiplyDivideRound(L(2), L(5), L(3)),
        L(3)
      )
      // Multiply by 0.
      assert.deepEqual(
        multiplyDivideRound(L(0), L(10000000000000000000), L(1)),
        L(0)
      )
    })

    it('is equivalent to round(a*b/c)', function () {
      for (let i = 0; i < REPS; i++) {
        const a = Math.floor(Math.random() * 100000000)
        const b = Math.floor(Math.random() * 100000000)
        const c = Math.floor(Math.random() * 100000000)

        const expect = new BigNumber(a).times(b).div(c)
          .integerValue(BigNumber.ROUND_HALF_UP)
        const result = multiplyDivideRound(L(a), L(b), L(c))

        assert.equal(
          result.toString(), expect.toString(),
          `attempt ${i}: ${result} != ${expect} = (${a}*${b}/${c})`
        )
      }
    })
  })

  describe('multiplyDivide', function () {
    it('returns a quotient and remainder', function () {
      assert.deepEqual(
        multiplyDivide(L(3), L(5), L(12)),
        { quo: L(1), rem: L(3) }
      )
    })
  })
})
