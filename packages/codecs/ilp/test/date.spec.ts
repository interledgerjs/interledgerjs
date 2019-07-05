import * as assert from 'assert'
import {
  dateToInterledgerTime,
  interledgerTimeToDate
} from '../src/utils/date'

describe('utils/date', function () {
  describe('interledgerTimeToDate', function () {
    it('matches dateToInterledgerTime', function () {
      for (let i = 0; i < 1000; i++) {
        const year = randomBetween(1000, 10000)
        const month = randomBetween(0, 12)
        const day = randomBetween(0, 28)
        const hour = randomBetween(0, 24)
        const minute = randomBetween(0, 60)
        const second = randomBetween(0, 60)
        const millisecond = randomBetween(0, 1000)
        const date = new Date(Date.UTC(year, month, day, hour, minute, second, millisecond))

        const ilpDate = dateToInterledgerTime(date)
        assert.deepEqual(interledgerTimeToDate(ilpDate), date)
      }
    })
  })
})

function randomBetween (min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min))
}
