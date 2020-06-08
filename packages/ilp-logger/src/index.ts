import * as debug from 'debug'

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

    // `debug().destroy()` leaves the logger usable, but allows it to be garbage
    // collected once references to the `Logger` have been dropped.
    //
    // The only change in functionality is that `debug.enable(namespaces)` won't
    // be able to dynamically change the enabled log levels, but we do not rely on
    // that functionality.
    //
    // Without `destroy()`, creating loggers with dynamically generated namespaces
    // leaks memory due to the `debug` closures and namespaces strings never being
    // cleaned up.
    //
    // See: https://github.com/visionmedia/debug/blob/80ef62a3af4df95250d77d64edfc3d0e1667e7e8/src/common.js#L134-L141
    this.info.destroy()
    this.warn.destroy()
    this.error.destroy()
    this.debug.destroy()
    this.trace.destroy()
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
