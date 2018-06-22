/// <reference types="node" />

declare module 'ilp-logger' {
  class Logger {
    private debugInfo;
    private debugWarn;
    private debugError;
    private debugger;
    private tracer;
    constructor(namespace: string);
    info(...msg: any[]): void;
    warn(...msg: any[]): void;
    error(...msg: any[]): void;
    debug(...msg: any[]): void;
    trace(...msg: any[]): void;
  }
  function createLogger(namespace: string): Logger;

  export = createLogger
}
