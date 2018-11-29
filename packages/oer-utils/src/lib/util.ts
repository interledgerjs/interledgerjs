import BigNumber from 'bignumber.js'

// How many bytes are safe to decode as a JS number
// MAX_SAFE_INTEGER = 2^53 - 1
// 53 div 8 -> 6 bytes
export const MAX_SAFE_BYTES = 6

const INTEGER_REGEX = /^-?[0-9]+$/
export function isInteger (value: any) {
  if (BigNumber.isBigNumber(value)) {
    return value.isFinite()
      && value.isInteger()
  } else if (typeof value === 'number') {
    return isFinite(value) && Math.floor(value) === value
  } else if (typeof value === 'string') {
    return !!INTEGER_REGEX.exec(value)
  } else {
    return false
  }
}

export function bufferToBigNumber (buffer: Buffer): BigNumber {
  return buffer.reduce(
    (sum, value) => sum.times(256).plus(value),
    new BigNumber(0)
  )
}

export function bigNumberToBuffer (value: BigNumber, length?: number): Buffer {
  const lengthOfValue = (length !== undefined ? length : Math.ceil(value.toString(2).length / 8))
  const buffer = Buffer.alloc(lengthOfValue)
  let big = value
  for (let i = buffer.length - 1; i >= 0; i--) {
    buffer.writeUInt8(big.modulo(256).toNumber(), i)
    big = big.dividedToIntegerBy(256)
  }
  return buffer
}

const BIG_VAR_UINT_SIZES: BigNumberSizeRange[] = [
  { max: new BigNumber(0xff), bytes: 1 },
  { max: new BigNumber(0xffff), bytes: 2 },
  { max: new BigNumber(0xffffff), bytes: 3 },
  { max: new BigNumber(0xffffffff), bytes: 4 },
  { max: new BigNumber(0xffffffffff), bytes: 5 },
  { max: new BigNumber(0xffffffffffff), bytes: 6 },
  { max: new BigNumber('ffffffffffffff', 16), bytes: 7 },
  { max: new BigNumber('ffffffffffffffff', 16), bytes: 8 }
]

const BIG_VAR_INT_SIZES: BigNumberSizeRange[] = [
  { min: new BigNumber(-0x80), max: new BigNumber(0x7f), bytes: 1 },
  { min: new BigNumber(-0x8000), max: new BigNumber(0x7fff), bytes: 2 },
  { min: new BigNumber(-0x800000), max: new BigNumber(0x7fffff), bytes: 3 },
  { min: new BigNumber(-0x80000000), max: new BigNumber(0x7fffffff), bytes: 4 },
  { min: new BigNumber(-0x8000000000), max: new BigNumber(0x7fffffffff), bytes: 5 },
  { min: new BigNumber(-0x800000000000), max: new BigNumber(0x7fffffffffff), bytes: 6 },
  { min: new BigNumber('-80000000000000', 16), max: new BigNumber('7fffffffffffff', 16), bytes: 7 },
  { min: new BigNumber('-8000000000000000', 16), max: new BigNumber('7fffffffffffffff', 16), bytes: 8 }
]

const VAR_UINT_SIZES: NumberSizeRange[] = makeNumberRanges(BIG_VAR_UINT_SIZES)
const VAR_INT_SIZES: NumberSizeRange[] = makeNumberRanges(BIG_VAR_INT_SIZES)

// Returns the minimum number of bytes required to encode the value.
export function getBigUIntBufferSize (value: BigNumber): number {
  for (let i = 0; i < BIG_VAR_UINT_SIZES.length; i++) {
    const item = BIG_VAR_UINT_SIZES[i]
    if (value.isLessThanOrEqualTo(item.max)) {
      // Fast path: no extra work converting a BigNumber to a String.
      return item.bytes
    }
  }
  return computeBigNumberBufferSize(value)
}

export function getUIntBufferSize (value: number): number {
  for (let i = 0; i < VAR_UINT_SIZES.length; i++) {
    const item = VAR_UINT_SIZES[i]
    if (value <= item.max) return item.bytes
  }
  return computeBigNumberBufferSize(new BigNumber(value))
}

// Returns the minimum number of bytes required to encode the value.
export function getBigIntBufferSize (value: BigNumber): number {
  for (let i = 0; i < VAR_INT_SIZES.length; i++) {
    const item = VAR_INT_SIZES[i]
    if (
      value.isGreaterThanOrEqualTo(item.min!) &&
      value.isLessThanOrEqualTo(item.max)
    ) {
      // Fast path: no extra work converting a BigNumber to a String.
      return item.bytes
    }
  }
  return computeBigNumberBufferSize(value)
}

export function getIntBufferSize (value: number): number {
  for (let i = 0; i < VAR_INT_SIZES.length; i++) {
    const item = VAR_INT_SIZES[i]
    if (value >= item.min! && value <= item.max) return item.bytes
  }
  return computeBigNumberBufferSize(new BigNumber(value))
}

function computeBigNumberBufferSize (value: BigNumber): number {
  return Math.ceil(value.toString(16).length / 2)
}

interface BigNumberSizeRange {
  // UInt ranges don't use min.
  min?: BigNumber,
  max: BigNumber,
  bytes: number
}

interface NumberSizeRange {
  // UInt ranges don't use min.
  min?: number,
  max: number,
  bytes: number
}

function makeNumberRanges (ranges: BigNumberSizeRange[]): NumberSizeRange[] {
  return ranges
    .filter((range) => range.bytes <= MAX_SAFE_BYTES)
    .map((range) => ({
      min: range.min && range.min.toNumber(),
      max: range.max.toNumber(),
      bytes: range.bytes
    }))
}
