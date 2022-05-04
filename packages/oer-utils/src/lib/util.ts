import * as Long from 'long'

// How many bytes are safe to decode as a JS number
// MAX_SAFE_INTEGER = 2^53 - 1
// 53 div 8 -> 6 bytes
export const MAX_SAFE_BYTES = 6

const INTEGER_REGEX = /^-?[0-9]+$/
export function isInteger(value: unknown): boolean {
  if (typeof value === 'number') {
    return isFinite(value) && Math.floor(value) === value
  } else if (typeof value === 'string') {
    return !!INTEGER_REGEX.exec(value)
  } else {
    return Long.isLong(value)
  }
}

export const isLong = Long.isLong

export function longFromValue(value: Long | string | number, unsigned: boolean): Long {
  if (typeof value === 'number') {
    if (unsigned && value < 0) {
      throw new Error('UInt must be positive')
    }
    return Long.fromNumber(value, unsigned)
  }

  if (isLong(value)) {
    if (value.unsigned !== unsigned) {
      if (unsigned) throw new Error('Expected unsigned Long')
      else throw new Error('Expected signed Long')
    }
    return value
  }

  if (unsigned && value[0] === '-') {
    throw new Error('UInt must be positive')
  }
  return Long.fromString(value, unsigned)
}

export function bufferToLong(buffer: Buffer, unsigned: boolean): Long {
  if (buffer.length > 8) {
    throw new Error((unsigned ? 'UInt' : 'Int') + ' of length ' + buffer.length + ' is too large')
  }

  if (unsigned) {
    return buffer.reduce((sum, value) => sum.shiftLeft(8).add(value), Long.UZERO)
  } else {
    return buffer.reduce(
      (sum, value, i) => sum.multiply(256).add(i === 0 && 0x80 <= value ? value - 0x100 : value),
      Long.ZERO
    )
  }
}

/**
 * @param value is unsigned
 * @param length
 */
export function longToBuffer(value: Long, length: number): Buffer {
  return Buffer.from(value.toBytesBE().slice(8 - length))
}

const LONG_VAR_UINT_SIZES: LongSizeRange[] = new Array(8)
const LONG_VAR_INT_SIZES: LongSizeRange[] = new Array(8)

for (let i = 0; i < 8; i++) {
  LONG_VAR_UINT_SIZES[i] = {
    min: Long.UZERO,
    max: Long.MAX_UNSIGNED_VALUE.shiftRightUnsigned(64 - 8 * (i + 1)),
    bytes: i + 1,
  }
  LONG_VAR_INT_SIZES[i] = {
    min: Long.MIN_VALUE.shiftRight(64 - 8 * (i + 1)),
    max: Long.MAX_VALUE.shiftRight(64 - 8 * (i + 1)),
    bytes: i + 1,
  }
}

const VAR_UINT_SIZES: NumberSizeRange[] = makeNumberRanges(LONG_VAR_UINT_SIZES)
const VAR_INT_SIZES: NumberSizeRange[] = makeNumberRanges(LONG_VAR_INT_SIZES)

// Returns the minimum number of bytes required to encode the value.
export function getLongUIntBufferSize(value: Long): number {
  for (let i = 0; i < LONG_VAR_UINT_SIZES.length; i++) {
    const item = LONG_VAR_UINT_SIZES[i]
    if (value.lessThanOrEqual(item.max)) {
      // Fast path: no extra work converting a Long to a String.
      return item.bytes
    }
  }
  throw new Error('unreachable')
}

export function getUIntBufferSize(value: number): number {
  for (let i = 0; i < VAR_UINT_SIZES.length; i++) {
    const item = VAR_UINT_SIZES[i]
    if (value <= item.max) return item.bytes
  }
  return computeLongBufferSize(Long.fromNumber(value, true))
}

// Returns the minimum number of bytes required to encode the value.
export function getLongIntBufferSize(value: Long): number {
  for (let i = 0; i < LONG_VAR_INT_SIZES.length; i++) {
    const item = LONG_VAR_INT_SIZES[i]
    if (value.greaterThanOrEqual(item.min) && value.lessThanOrEqual(item.max)) {
      // Fast path: no extra work converting a Long to a String.
      return item.bytes
    }
  }
  throw new Error('unreachable')
}

export function getIntBufferSize(value: number): number {
  for (let i = 0; i < VAR_INT_SIZES.length; i++) {
    const item = VAR_INT_SIZES[i]
    if (value >= item.min && value <= item.max) return item.bytes
  }
  return computeLongBufferSize(Long.fromNumber(value, false))
}

function computeLongBufferSize(value: Long): number {
  return Math.ceil(value.toString(16).length / 2)
}

interface LongSizeRange {
  // UInt ranges don't use min.
  min: Long
  max: Long
  bytes: number
}

interface NumberSizeRange {
  // UInt ranges don't use min.
  min: number
  max: number
  bytes: number
}

function makeNumberRanges(ranges: LongSizeRange[]): NumberSizeRange[] {
  return ranges
    .filter((range) => range.bytes <= MAX_SAFE_BYTES)
    .map((range) => ({
      min: range.min && range.min.toNumber(),
      max: range.max.toNumber(),
      bytes: range.bytes,
    }))
}
