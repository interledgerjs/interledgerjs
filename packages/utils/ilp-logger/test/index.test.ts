import 'mocha'
import createLogger, { Logger } from '..'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
Chai.use(chaiAsPromised)
const assert = Object.assign(Chai.assert, sinon.assert)
require('source-map-support').install()

describe('ilp-logger', function () {

  describe('createLogger', function () {
    it('should return an instance of a Logger', function () {
      const log = createLogger('TEST')
      assert(typeof(log.info) === 'function')
      assert(typeof(log.warn) === 'function')
      assert(typeof(log.error) === 'function')
      assert(typeof(log.debug) === 'function')
      assert(typeof(log.trace) === 'function')
      assert.instanceOf(log, Logger)
    })

    it('should append :info to namespace for log.info', function () {
      const log = createLogger('TEST')
      log.info.log = (text: string) => {
        assert(text.startsWith('TEST:info'))
      }
      log.info('lorum')
    })

    it('should append :warn to namespace for log.warn', function () {
      const log = createLogger('TEST')
      log.warn.log = (text: string) => {
        assert(text.startsWith('TEST:warn'))
      }
      log.warn('lorum')
    })

    it('should append :error to namespace for log.error', function () {
      const log = createLogger('TEST')
      log.error.log = (text: string) => {
        assert(text.startsWith('TEST:error'))
      }
      log.error('lorum')
    })

    it('should append :debug to namespace for log.debug', function () {
      const log = createLogger('TEST')
      log.debug.log = (text: string) => {
        assert(text.startsWith('TEST:debug'))
      }
      log.debug('lorum')
    })

    it('should append :trace to namespace for log.trace', function () {
      const log = createLogger('TEST')
      log.trace.log = (text: string) => {
        assert(text.startsWith('TEST:trace'))
      }
      log.trace('lorum')
    })
  })
})
