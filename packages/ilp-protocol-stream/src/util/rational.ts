import * as assert from 'assert'
import * as Long from 'long'
import {
  multiplyDivideFloor,
  multiplyDivideCeil,
  multiplyDivideRound
} from './long'
require('source-map-support').install()

export default class Rational {
  static UZERO = new Rational(Long.UZERO, Long.UONE, true)

  private a: Long
  private b: Long
  public unsigned: boolean

  constructor (numer: Long, denom: Long, unsigned: boolean) {
    if (!unsigned) {
      throw new Error('signed rationals are not implemented')
    }
    assert.strictEqual(numer.unsigned, unsigned, 'numerator is incorrectly signed')
    assert.strictEqual(denom.unsigned, unsigned, 'denominator is incorrectly signed')
    assert(!denom.isZero(), 'denominator must be non-zero')
    this.a = numer
    this.b = denom
    this.unsigned = unsigned
  }

  static isRational (value: any): value is Rational {
    return value instanceof Rational
  }

  static fromNumbers (numer: number, denom: number, unsigned: boolean): Rational {
    return new Rational(
      Long.fromNumber(numer, unsigned),
      Long.fromNumber(denom, unsigned),
      unsigned
    )
  }

  static fromNumber (value: number, unsigned: boolean): Rational {
    if (!isFinite(value)) {
      throw new Error('value must be finite')
    } else if (unsigned && value < 0) {
      throw new Error('unsigned value must be positive')
    }

    // Integers become value/1.
    if (value % 1 === 0) {
      return Rational.fromNumbers(value, 1, unsigned)
    }

    // Really simple float → rational conversion. There's probably a better way
    // to do this. That said, creating a Rational from two Longs is always going
    // to be more precise.
    const mag = Math.floor(Math.log(value) / Math.LN10)
    let shift = mag < 0 ? 18 : (18 - mag)
    let den = 1
    while (
      Math.floor(value * den) !== value * den &&
      shift > 0
    ) {
      den *= 10
      shift--
    }

    return Rational.fromNumbers(value * den, den, unsigned)
  }

  /**
   * Multiply a rational by a Long without intermediate overflow.
   */
  multiplyByLong (value: Long): Long {
    return multiplyDivideFloor(value, this.a, this.b)
  }

  multiplyByLongCeil (value: Long): Long {
    return multiplyDivideCeil(value, this.a, this.b)
  }

  multiplyByRational (other: Rational): Rational {
    return new Rational(
      this.a.multiply(other.a),
      this.b.multiply(other.b),
      this.unsigned
    )
  }

  greaterThanOne (): boolean {
    return this.a.greaterThan(this.b)
  }

  /**
   * Returns `1 - this`.
   */
  complement (): Rational {
    if (this.a.greaterThan(this.b)) {
      throw new Error('cannot take complement of rational >1')
    }
    return new Rational(this.b.subtract(this.a), this.b, this.unsigned)
  }

  /**
   * Returns `1 / this`.
   */
  reciprocal (): Rational {
    return new Rational(this.b, this.a, this.unsigned)
  }

  toNumber (): number {
    return this.a.toNumber() / this.b.toNumber()
  }

  toString (): string {
    // 19 is the highest precision achievable using this method, since 1e19 is
    // the largest power of 10 that fits in a uint64.
    const str = trimRight(this.toFixed(19), '0')
    return str[str.length - 1] === '.'
         ? str.slice(0, -1)
         : str
  }

  private toFixed (digits?: number): string {
    digits = digits || 0
    const quotient = this.a.divide(this.b)
    if (digits === 0) {
      return quotient.toString()
    }

    const remainder = this.a.modulo(this.b)
    const remainderString = multiplyDivideRound(
      remainder,
      power10(digits),
      this.b
    ).toString()

    return quotient.toString() +
      '.' +
      '0'.repeat(digits - remainderString.length) +
      remainderString
  }
}

function trimRight (str: string, ch: string): string {
  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] !== ch) {
      return str.slice(0, i + 1)
    }
  }
  return ''
}

function power10 (n: number): Long {
  const ten = Long.fromNumber(10, true)
  let value = Long.UONE
  while (n--) value = value.multiply(ten)
  return value
}
