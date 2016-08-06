'use strict'

const BaseError = require('../src/errors/base-error')

const assert = require('chai').assert

describe('BaseError', function () {
  it('should default to an empty error message', function () {
    const err = new BaseError()

    assert.equal(err.message, '')
  })
})
