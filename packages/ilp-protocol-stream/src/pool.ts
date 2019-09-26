import createLogger from 'ilp-logger'
import * as IlpPacket from 'ilp-packet'
import { buildConnection, Connection, FullConnectionOpts } from './connection'
import * as cryptoHelper from './crypto'

const log = createLogger('ilp-protocol-stream:Pool')

interface ConnectionEvent {
  (connection: Connection): void
}

type ConnectionOptions = Omit<FullConnectionOpts, 'sharedSecret'>

export class ServerConnectionPool {
  private serverSecret: Buffer
  private connectionOpts: ConnectionOptions
  private onConnection: ConnectionEvent
  private log: any
  private activeConnections: { [id: string]: Connection }
  private pendingConnections: { [id: string]: Promise<Connection> }
  private closedConnections: Set<string>

  constructor (
    serverSecret: Buffer,
    connectionOpts: ConnectionOptions,
    onConnection: ConnectionEvent
  ) {
    this.serverSecret = serverSecret
    this.connectionOpts = connectionOpts
    this.onConnection = onConnection
    this.activeConnections = {}
    this.pendingConnections = {}
    this.closedConnections = new Set()
  }

  async close (): Promise<void> {
    await Promise.all(Object.keys(this.activeConnections)
      .map((id: string) => this.activeConnections[id].end()))
  }

  async getConnection (
    id: string,
    prepare: IlpPacket.IlpPrepare
  ): Promise<Connection> {
    if (this.closedConnections.has(id)) {
      this.log.debug('got packet for connection that was already closed: %s', id)
      throw new Error('connection already closed')
    }

    const activeConnection = this.activeConnections[id]
    if (activeConnection) return Promise.resolve(activeConnection)
    const pendingConnection = this.pendingConnections[id]
    if (pendingConnection) return pendingConnection

    const connectionPromise = (async () => {
      const sharedSecret = await this.getSharedSecret(id, prepare)
      // If we get here, that means it was a token + sharedSecret we created
      const tilde = id.indexOf('~')
      const connectionTag = tilde !== -1 ? id.slice(tilde + 1) : undefined
      const conn = await buildConnection({
        ...this.connectionOpts,
        sharedSecret,
        connectionTag
      })
      log.debug('got incoming packet for new connection: %s%s', id, (connectionTag ? ' (connectionTag: ' + connectionTag + ')' : ''))
      try {
        this.onConnection(conn)
      } catch (err) {
        log.error('error in connection event handler:', err)
      }

      conn.once('close', () => {
        delete this.pendingConnections[id]
        delete this.activeConnections[id]
        this.closedConnections.add(id)
      })
      return conn
    })()

    connectionPromise.catch(() => {
      delete this.pendingConnections[id]
    })

    this.pendingConnections[id] = connectionPromise
    const connection = await connectionPromise
    this.activeConnections[id] = connection
    delete this.pendingConnections[id]

    // Wait for the next tick of the event loop before handling the prepare
    await new Promise((resolve, reject) => setImmediate(resolve))
    return connection
  }

  private async getSharedSecret (
    id: string,
    prepare: IlpPacket.IlpPrepare
  ): Promise<Buffer> {
    try {
      const token = Buffer.from(id, 'ascii')
      const sharedSecret = await cryptoHelper.generateSharedSecretFromToken(
        this.serverSecret, token)
      // TODO just pass this into the connection?
      const pskKey = await cryptoHelper.generatePskEncryptionKey(sharedSecret)
      await cryptoHelper.decrypt(pskKey, prepare.data)
      return sharedSecret
    } catch (err) {
      log.error('got prepare for an address and token that we did not generate: %s', prepare.destination)
      throw err
    }
  }
}
