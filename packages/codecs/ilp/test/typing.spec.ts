import { assert } from 'chai'
import { isFulfill, isPrepare, isReject } from '..'

describe('Types', function () {
  describe('isPrepare', function () {
    it('returns true for valid prepare', function () {
      assert.isTrue(isPrepare({
        destination: '',
        amount: '',
        executionCondition: Buffer.alloc(0),
        expiresAt: new Date(),
        data: Buffer.alloc(0)
      }))
    })
    it('returns false for invalid prepare', function () {
      assert.isFalse(isPrepare({
        code: '',
        triggeredBy: '',
        message: '',
        data: Buffer.alloc(0)
      }))
    })
  })
  describe('isFulfill', function () {
    it('returns true for valid fullfill', function () {
      assert.isTrue(isFulfill({
        fulfillment: Buffer.alloc(0),
        data: Buffer.alloc(0)
      }))
    })
    it('returns false for invalid fullfill', function () {
      assert.isFalse(isFulfill({
        code: '',
        triggeredBy: '',
        message: '',
        data: Buffer.alloc(0)
      }))
    })
  })
  describe('isReject', function () {
    it('returns true for valid reject', function () {
      assert.isTrue(isReject({
        code: '',
        triggeredBy: '',
        message: '',
        data: Buffer.alloc(0)
      }))
    })
    it('returns false for invalid reject', function () {
      assert.isFalse(isReject({
        fulfillment: Buffer.alloc(0),
        data: Buffer.alloc(0)
      }))
    })
  })
})
