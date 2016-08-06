'use strict'

/**
 * @module util
 */

/**
 * Extensible error class.
 *
 * The built-in Error class is not actually a constructor, but a factory. It
 * doesn't operate on `this`, so if we call it as `super()` it doesn't do
 * anything useful.
 *
 * Nonetheless it does create objects that are instanceof Error. In order to
 * easily subclass error we need our own base class which mimics that behavior
 * but with a true constructor.
 *
 * Note that this code is specific to V8 (due to `Error.captureStackTrace`).
 */
class BaseError extends Error {
  constructor (message) {
    super()

    // Set this.message
    Object.defineProperty(this, 'message', {
      configurable: true,
      enumerable: false,
      value: message !== undefined ? String(message) : ''
    })

    // Set this.name
    Object.defineProperty(this, 'name', {
      configurable: true,
      enumerable: false,
      value: this.constructor.name
    })

    // Set this.stack
    Error.captureStackTrace(this, this.constructor)
  }
}

module.exports = BaseError
