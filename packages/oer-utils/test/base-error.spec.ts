import BaseError from '../src/errors/base-error'

import chai = require('chai')
const assert = chai.assert

describe('BaseError', function () {
  it('should default to an empty error message', function () {
    const err = new BaseError()

    assert.equal(err.message, '')
  })

  it('should still work if Error.captureStackTrace is not available', function () {
    const captureStackTrace = Error.captureStackTrace

    // @ts-expect-error We're not supposed to delete stuff off of built-ins
    delete Error.captureStackTrace

    const err = new BaseError()

    assert.equal(err.message, '')

    Error.captureStackTrace = captureStackTrace
  })
})
