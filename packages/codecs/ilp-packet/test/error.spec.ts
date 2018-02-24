import { assert } from 'chai'

const { Errors } = require('..')

describe('Errors', function () {
  describe('AmountTooLargeError', function () {
    it('encodes receivedAmount and maximumAmount', function () {
      const error = new Errors.AmountTooLargeError('amount too large', {
        receivedAmount: '255',
        maximumAmount: '65535'
      })

      assert.equal(error.message, 'amount too large')
      assert.equal(error.ilpErrorCode, Errors.codes.F08_AMOUNT_TOO_LARGE)
      assert.deepEqual(error.ilpErrorData, Buffer.from([
        0, 0, 0, 0, 0, 0, 0, 0xff,
        0, 0, 0, 0, 0, 0, 0xff, 0xff
      ]))
    })
  })
})
