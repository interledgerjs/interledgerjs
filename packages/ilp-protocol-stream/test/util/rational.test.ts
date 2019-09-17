import 'mocha'
import * as assert from 'assert'
import BigNumber from 'bignumber.js'
import * as Long from 'long'
import Rational from '../../src/util/rational'

function L (value: number, unsigned?: boolean): Long {
  return Long.fromNumber(value, unsigned === undefined ? true : unsigned)
}

// The number of times to repeat each randomized test.
const REPS = 10000

describe('Rational', function () {
  describe('constructor', function () {
    it('should throw if the numerator is incorrectly signed', function () {
      assert.throws(
        () => { new Rational(L(123, false), L(123, true), true) },
        /numerator is incorrectly signed/
      )
    })

    it('should throw if the denominator is incorrectly signed', function () {
      assert.throws(
        () => new Rational(L(123, true), L(123, false), true),
        /denominator is incorrectly signed/
      )
    })

    it('should throw if the denominator is zero', function () {
      assert.throws(
        () => new Rational(L(123, true), Long.UZERO, true),
        /denominator must be non-zero/
      )
    })
  })

  describe('isRational', function () {
    it('returns true for Rational', function () {
      const value = Rational.fromNumbers(123, 456, true)
      assert.strictEqual(Rational.isRational(value), true)
    })

    it('returns false for Number', function () {
      assert.strictEqual(Rational.isRational(123), false)
    })

    it('returns false for String', function () {
      assert.strictEqual(Rational.isRational('123'), false)
    })
  })

  describe('fromNumber', function () {
    it('creates a Rational from known values', function () {
      assert.deepEqual(
        Rational.fromNumber(0, true),
        new Rational(L(0), L(1), true)
      )

      assert.deepEqual(
        Rational.fromNumber(1, true),
        new Rational(L(1), L(1), true)
      )

      // Integer:
      assert.deepEqual(
        Rational.fromNumber(123, true),
        new Rational(L(123), L(1), true)
      )

      assert.deepEqual(
        Rational.fromNumber(0.5, true).toNumber(),
        0.5
      )
    })

    it('creates a Rational from very small values', function () {
      assert.deepEqual(
        Rational.fromNumber(1.0e-10, true).toNumber(),
        1.0e-10
      )
      assert.deepEqual(
        Rational.fromNumber(1.23e-10, true).toNumber(),
        1.23e-10
      )
      assert.deepEqual(
        Rational.fromNumber(1.0e-17, true).toNumber(),
        1.0e-17
      )
    })

    it('creates a Rational from a floating-point number', function () {
      for (let i = 0; i < REPS; i++) {
        const value = Math.random() * 10
        const result = Rational.fromNumber(value, true).toNumber()
        assert(
          Math.abs(result - value) < 1.0e-14,
          `attempt=${i} got=${result} want=${value}`
        )
      }
    })

    it('throws creating an unsigned Rational from a non-finite number', function () {
      assert.throws(
        () => Rational.fromNumber(Infinity, true),
        /value must be finite/
      )
    })

    it('throws creating an unsigned Rational from a negative number', function () {
      assert.throws(
        () => Rational.fromNumber(-123, true),
        /unsigned value must be positive/
      )
    })
  })

  describe('multiplyByLong', function () {
    it('multiplies by a Long', function () {
      const rat = Rational.fromNumbers(1, 3, true)
      assert.deepEqual(rat.multiplyByLong(L(100)), L(33))
      assert.deepEqual(rat.multiplyByLong(L(200)), L(66))
    })
  })

  describe('multiplyByLongCeil', function () {
    it('multiplies by a Long', function () {
      const rat = Rational.fromNumbers(1, 3, true)
      assert.deepEqual(rat.multiplyByLongCeil(L(100)), L(34))
    })
  })

  describe('multiplyByRational', function () {
    it('multiplies two rational numbers', function () {
      for (let i = 0; i < REPS; i++) {
        const a = Math.floor(Math.random() * 100000000)
        const b = Math.floor(Math.random() * 100000000)
        const c = Math.floor(Math.random() * 100000000)
        const d = Math.floor(Math.random() * 100000000)

        const rat1 = Rational.fromNumbers(a, b, true)
        const rat2 = Rational.fromNumbers(c, d, true)

        const result = new BigNumber(rat1.multiplyByRational(rat2).toString())
        const expect = new BigNumber(a).times(c)
          .div(b).div(d)

        assert(
          result.minus(expect).abs().lt(1.0e-19),
          `attempt ${i}: ${result} != ${expect} = ((${a}/${b}) * (${c}/${d}))`
        )
      }
    })
  })

  describe('complement', function () {
    it('returns (1 - this)', function () {
      assert.deepEqual(
        Rational.fromNumbers(1, 3, true).complement(),
        Rational.fromNumbers(2, 3, true)
      )
    })

    it('should throw if >1', function () {
      const value = Rational.fromNumbers(4, 3, true)
      assert.throws(
        () => value.complement(),
        /cannot take complement of rational >1/
      )
    })
  })

  describe('reciprocal', function () {
    it('swaps the numerator and denominator', function () {
      assert.deepEqual(
        Rational.fromNumbers(1, 2, true).reciprocal(),
        Rational.fromNumbers(2, 1, true)
      )
    })
  })

  describe('toString', function () {
    it('returns a string', function () {
      assert.equal(Rational.fromNumbers(1, 2, true).toString(), '0.5')
      assert.equal(Rational.fromNumbers(2, 1, true).toString(), '2')
      assert.equal(Rational.UZERO.toString(), '0')
    })

    it('returns a string for a Rational with a large numerator', function () {
      const value1 = new Rational(Long.MAX_UNSIGNED_VALUE, L(1), true)
      assert.equal(value1.toString(), '18446744073709551615')

      const value2 = new Rational(Long.MAX_UNSIGNED_VALUE, L(1000), true)
      assert.equal(value2.toString(), '18446744073709551.615')

      const value3 = new Rational(Long.MAX_UNSIGNED_VALUE, L(1000000), true)
      assert.equal(value3.toString(), '18446744073709.551615')
    })

    it('returns a string for a Rational with a small numerator', function () {
      const value = Rational.fromNumbers(150, 150000, true)
      assert.equal(value.toString(), '0.001')
    })
  })
})
