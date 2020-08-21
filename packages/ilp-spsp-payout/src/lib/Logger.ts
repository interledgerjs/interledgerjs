export interface Logger {
  debug: LogMethod
  info: LogMethod
  warn: LogMethod
  error: LogMethod
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type LogMethod = (message: string, ...optionalParams: any[]) => void

export const defaultLogger = { debug: noop, info: noop, warn: noop, error: noop }

/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-unused-vars */
function noop(_s: string): void {}
