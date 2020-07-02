import { assert } from 'chai'
import { isFulfill, isPrepare, isReject } from 'ilp-packet'

describe('Types', function () {
  describe('isPrepare', function () {
    it('returns true for valid prepare', function () {
      assert.isTrue(
        isPrepare({
          destination: 'test.recipient',
          amount: '10',
          executionCondition: Buffer.alloc(32),
          expiresAt: new Date(),
          data: Buffer.alloc(0),
        })
      )
    })
    it('returns false for invalid prepare', function () {
      assert.isFalse(
        isPrepare({
          code: '',
          triggeredBy: '',
          message: '',
          data: Buffer.alloc(0),
        })
      )
      assert.isFalse(
        isPrepare({
          destination: 'test2.alice',
          amount: '10',
          executionCondition: Buffer.alloc(31), // Invalid byte length
          expiresAt: new Date(),
          data: Buffer.alloc(0),
        })
      )
      assert.isFalse(
        isPrepare({
          destination: 'example', // Invalid address
          amount: '10',
          executionCondition: Buffer.alloc(32),
          expiresAt: new Date(),
          data: Buffer.alloc(0),
        })
      )
      assert.isFalse(
        isPrepare({
          destination: 'g.someone',
          amount: '10',
          executionCondition: Buffer.alloc(32),
          expiresAt: new Date('invalid'), // Invalid date
          data: Buffer.alloc(0),
        })
      )
      assert.isFalse(
        isPrepare({
          destination: 'g.someone',
          amount: '-1.2', // Invalid amount
          executionCondition: Buffer.alloc(32),
          expiresAt: new Date(),
          data: Buffer.alloc(0),
        })
      )
    })
  })
  describe('isFulfill', function () {
    it('returns true for valid fullfill', function () {
      assert.isTrue(
        isFulfill({
          fulfillment: Buffer.alloc(32),
          data: Buffer.alloc(0),
        })
      )
    })
    it('returns false for invalid fullfill', function () {
      assert.isFalse(
        isFulfill({
          code: '',
          triggeredBy: '',
          message: '',
          data: Buffer.alloc(0),
        })
      )
      assert.isFalse(
        isFulfill({
          fulfillment: Buffer.alloc(2),
          data: Buffer.alloc(0),
        })
      )
    })
  })
  describe('isReject', function () {
    it('returns true for valid reject', function () {
      assert.isTrue(
        isReject({
          code: 'F01',
          triggeredBy: '',
          message: '',
          data: Buffer.alloc(0),
        })
      )
    })
    it('returns false for invalid reject', function () {
      assert.isFalse(
        isReject({
          fulfillment: Buffer.alloc(0),
          data: Buffer.alloc(0),
        })
      )
      assert.isFalse(
        isReject({
          code: 'T99',
          triggeredBy: 'g.someone.', // Invalid address
          message: 'Error',
          data: Buffer.alloc(0),
        })
      )
    })
  })
})
