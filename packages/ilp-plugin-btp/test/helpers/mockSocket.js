'use strict'

const EventEmitter = require('events')
const btp = require('btp-packet')

const chai = require('chai')
chai.use(require('chai-as-promised'))
const assert = chai.assert

class MockSocket extends EventEmitter {
  constructor () {
    super()
    this.responses = []
    this.error = null
  }

  send (data, opts, cb) {
    setImmediate(() => { // emulates that sending data is asynchronous
      cb() // called because sending is finished

      setImmediate(() => { // emulates that receiving a response is asynchronous
        const btpEnvelope = btp.deserialize(data)
        const handler = this.responses.shift()

        if (!handler) {
          throw new Error('Missing mock request handler. ' +
            'Add request handlers with mockSocket.reply().')
        }
        try {
          const response = handler(btpEnvelope)
          if (response) {
            this.emit('message', response)
          }
        } catch (err) {
          this.error = err
          if (this.failure) {
            this.failure(err)
          } else { throw err }
        }

        if (this.responses.length === 0) {
          this.success && this.success()
        }
      })
    })
  }

  /**
   * Registers a packet handler. Each packet received by an instance of
   * MockSocket needs to be processed by such a handler and each handler only
   * processes one packet. The handlers are called in the same order as they
   * were registered, so the first received packet is proccessed by the 
   * handler that was registered first, the second packet by the handler 
   * that registered second etc.
   * 
   * @param  {[type]}   expectedType [The expected type of the received packet]
   * @param  {Function} fn           [Function that processes the received packet]
   * @return {[type]}                [Returns a MockSocket instance for function chaining]
   */
  reply (expectedType, fn) {
    if (typeof expectedType !== 'number') {
      throw new TypeError('expectedType must be number')
    }
    const requiresReply = [btp.TYPE_PREPARE, btp.TYPE_FULFILL, btp.TYPE_REJECT,
      btp.TYPE_MESSAGE].includes(expectedType)
    if (!fn && requiresReply) {
      throw new TypeError('no request handler provided')
    }

    const handler = (btpEnvelope) => {
      const actualType = btpEnvelope.type
      assert.equal(actualType, expectedType,
        `Received BTP packet of type ${actualType}, but expected ${expectedType}`)

      if (fn) {
        return fn(btpEnvelope)
      }
    }

    this.responses.push(handler)
    return this
  }

  /**
   * Returns a promise indicating whether all packet handlers registered 
   * via .reply() have been called. If any of the handlers throws
   * an error the promise will reject. If all handlers finish without error,
   * the promise will resolve.
   * 
   * @return {Boolean} True if all handlers finished without errors, false otherwise.
   */
  async isDone () {
    if (this.error) { return Promise.reject(this.error) }
    if (this.responses.length === 0) { return Promise.resolve(true) }

    // make sure all request handlers have been executed
    this.processed = new Promise((resolve, reject) => {
      this.success = resolve.bind(null, true)
      this.failure = reject
    })

    return this.processed
  }

  close () {}
}

module.exports = MockSocket
