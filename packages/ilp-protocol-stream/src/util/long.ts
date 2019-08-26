import * as Long from 'long'
require('source-map-support').install()

export type LongValue = Long | string | number

export function longFromValue (value: LongValue, unsigned: boolean): Long {
  if (typeof value === 'number') {
    if (unsigned && value < 0) {
      throw new Error('Expected positive number')
    }
    return Long.fromNumber(value, unsigned)
  }

  if (typeof value === 'string') {
    if (unsigned && value[0] === '-') {
      throw new Error('Expected positive number')
    }
    const longValue = Long.fromString(value, unsigned)
    if (longValue.toString() !== value) {
      // Throw when `Long.fromString` wraps a too-large number.
      throw new Error('Value ' + value + ' does not fit in a Long.')
    }
    return longValue
  }

  if (value.unsigned !== unsigned) {
    throw new Error('Expected ' + (unsigned ? 'unsigned' : 'signed') + ' Long')
  }

  return value
}

export function maxLong (a: Long, b: Long): Long {
  return a.greaterThan(b) ? a : b
}

export function minLong (a: Long, b: Long): Long {
  return a.lessThan(b) ? a : b
}

export function minLongs (values: Long[]): Long {
  let min = values[0]
  for (let i = 1; i < values.length; i++) {
    min = minLong(min, values[i])
  }
  return min
}

export function countDigits (value: Long): number {
  let digits = 0
  while (!value.isZero()) {
    digits++
    value = value.divide(10)
  }
  return digits
}

export function checkedAdd (a: Long, b: Long): {
  sum: Long,
  overflow: boolean
} {
  const sum = a.add(b)
  const overflow = sum.lessThan(a) || sum.lessThan(b)
  return {
    sum: overflow ? Long.MAX_UNSIGNED_VALUE : sum,
    overflow
  }
}

export function checkedSubtract (a: Long, b: Long): {
  difference: Long,
  underflow: boolean
} {
  const difference = a.subtract(b)
  const underflow = difference.greaterThan(a) && difference.greaterThan(b)
  return {
    difference: underflow ? Long.UZERO : difference,
    underflow
  }
}

export function checkedMultiply (a: Long, b: Long): {
  product: Long,
  overflow: boolean
} {
  const product = a.multiply(b)
  const overflow = product.lessThan(a) || product.lessThan(b)
  return {
    product: overflow ? Long.MAX_UNSIGNED_VALUE : product,
    overflow
  }
}

/**
 * Algorithm from https://en.wikipedia.org/wiki/Ancient_Egyptian_multiplication
 *
 * returns a * b / c, floored
 */
export function multiplyDivideFloor (a: Long, b: Long, c: Long): Long {
  return multiplyDivide(a, b, c).quo
}

export function multiplyDivideCeil (a: Long, b: Long, c: Long): Long {
  const { quo, rem } = multiplyDivide(a, b, c)
  // Never wrap to 0.
  if (quo.equals(Long.MAX_UNSIGNED_VALUE)) return quo
  return quo.add(rem.isZero() ? 0 : 1)
}

export function multiplyDivideRound (a: Long, b: Long, c: Long): Long {
  const { quo, rem } = multiplyDivide(a, b, c)
  // Never wrap to 0.
  if (quo.equals(Long.MAX_UNSIGNED_VALUE)) return quo
  const roundUp = !rem.isZero() && (
    c.isOdd()
      ? rem.greaterThan(c.divide(2)) // 5/2 ≅ 2
      : rem.greaterThanOrEqual(c.divide(2)) // 4/2 = 2
  )
  return roundUp ? quo.add(Long.UONE) : quo
}

export function multiplyDivide (a: Long, b: Long, c: Long): {
  quo: Long,
  rem: Long
} {
  let quo = Long.UZERO // quotient
  let rem = Long.UZERO // remainder
  let qn = b.divide(c)
  let rn = b.modulo(c)

  while (!a.isZero()) {
    let oldQuo = quo
    if (!a.and(Long.UONE).isZero()) {
      quo = quo.add(qn)
      rem = rem.add(rn)
      if (rem.greaterThanOrEqual(c)) {
        quo = quo.add(Long.UONE)
        rem = rem.subtract(c)
      }
    }

    // Overflow.
    if (quo.lessThan(oldQuo)) {
      return { quo: Long.MAX_UNSIGNED_VALUE, rem: Long.UZERO }
    }

    a = a.shiftRightUnsigned(1)
    qn = qn.shiftLeft(1)
    rn = rn.shiftLeft(1)
    if (rn.greaterThanOrEqual(c)) {
      qn = qn.add(Long.UONE)
      rn = rn.subtract(c)
    }
  }
  return { quo, rem }
}

Long.prototype['toJSON'] = function () {
  return this.toString()
}
