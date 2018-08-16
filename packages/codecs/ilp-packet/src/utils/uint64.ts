import { BigNumber } from 'bignumber.js'

const HIGH_WORD_MULTIPLIER = 0x100000000

export const twoNumbersToString = (num: number[]) => {
  const [ hi, lo ] = num
  const uint64 = new BigNumber(hi).times(HIGH_WORD_MULTIPLIER).plus(lo)
  return uint64.toString(10)
}

export const stringToTwoNumbers = (num: string) => {
  const uint64 = new BigNumber(num)
  return [
    uint64.dividedToIntegerBy(HIGH_WORD_MULTIPLIER).toNumber(),
    uint64.modulo(HIGH_WORD_MULTIPLIER).toNumber()
  ]
}
