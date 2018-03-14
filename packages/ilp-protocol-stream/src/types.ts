export interface Plugin {
  connect: () => Promise<void>,
  disconnect: () => Promise<void>,
  sendData: (data: Buffer) => Promise<Buffer>,
  registerDataHandler: (handler: (data: Buffer) => Promise<Buffer>) => void,
  deregisterDataHandler: () => void
}
