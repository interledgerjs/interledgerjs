import debug from 'debug'

export class Logger {
  private namespace: string
  public info: debug.Debugger
  public warn: debug.Debugger
  public error: debug.Debugger
  public debug: debug.Debugger
  public trace: debug.Debugger

  constructor(namespace: string) {
    this.namespace = namespace
    this.info = debug(namespace + ':info')
    this.warn = debug(namespace + ':warn')
    this.error = debug(namespace + ':error')
    this.debug = debug(namespace + ':debug')
    this.trace = debug(namespace + ':trace')
  }

  extend(namespace: string): Logger {
    return new Logger(`${this.namespace}:${namespace}`)
  }
}

export const formatters = debug.formatters

const createLogger = function (namespace: string) {
  return new Logger(namespace)
} as ModuleExport

interface ModuleExport {
  (namespace: string): Logger
  default: ModuleExport
  Logger: typeof Logger
  formatters: debug.Formatters
}

createLogger.default = createLogger
createLogger.Logger = Logger
createLogger.formatters = debug.formatters
export default createLogger

module.exports = createLogger
