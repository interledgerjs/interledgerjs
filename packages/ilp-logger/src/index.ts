import * as debug from 'debug'

export class Logger {
  public info: debug.IDebugger
  public warn: debug.IDebugger
  public error: debug.IDebugger
  public debug: debug.IDebugger
  public trace: debug.IDebugger
  constructor (namespace: string) {
    this.info = debug(namespace + ':info')
    this.warn = debug(namespace + ':warn')
    this.error = debug(namespace + ':error')
    this.debug = debug(namespace + ':debug')
    this.trace = debug(namespace + ':trace')
  }
}

export const formatters = debug.formatters

const createLogger = function (namespace: string) {
  return new Logger(namespace)
} as ModuleExport

interface ModuleExport {
  (namespace: string): Logger
  default: ModuleExport
  Logger: Function
  formatters: debug.IFormatters
}

createLogger.default = createLogger
createLogger.Logger = Logger
createLogger.formatters = debug.formatters
export default createLogger

module.exports = createLogger
