/** @private */
export interface Plugin {
  connect: () => Promise<void>,
  disconnect: () => Promise<void>,
  isConnected: () => boolean,
  sendData: (data: Buffer) => Promise<Buffer>,
  registerDataHandler: (handler: (data: Buffer) => Promise<Buffer>) => void,
  deregisterDataHandler: () => void
}
