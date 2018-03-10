import BigNumber from 'bignumber.js'

export function isInteger (value: any) {
  if (BigNumber.isBigNumber(value)) {
    return value.isFinite()
      && value.isInteger()
  } else {
    return typeof value !== 'object'
      && typeof value !== 'function'
      && isFinite(value)
      && Math.floor(value) === value
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
