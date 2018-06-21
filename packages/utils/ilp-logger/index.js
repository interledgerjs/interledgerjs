'use strict'
const debug = require('debug')

class Logger {
  constructor (namespace) {
    this.debugInfo = debug(namespace + ':info')
    this.debugWarn = debug(namespace + ':warn')
    this.debugError = debug(namespace + ':error')
    this.debugger = debug(namespace + ':debug')
    this.tracer = debug(namespace + ':trace')
  }

  info (msg) {
    this.debugInfo(msg)
  }

  warn (msg) {
    this.debugWarn(msg)
  }

  error (msg) {
    this.debugError(msg)
  }

  debug (msg) {
    this.debugger(msg)
  }

  trace (msg) {
    this.tracer(msg)
  }
}

function createLogger (namespace) {
  return new Logger(namespace)
}

module.exports = createLogger
