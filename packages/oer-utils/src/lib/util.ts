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
