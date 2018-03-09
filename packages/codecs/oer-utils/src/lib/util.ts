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