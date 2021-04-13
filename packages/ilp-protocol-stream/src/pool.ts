import createLogger from 'ilp-logger'
import * as IlpPacket from 'ilp-packet'
import { Reader } from 'oer-utils'
import { Connection, BuildConnectionOpts } from './connection'
import * as cryptoHelper from './crypto'

const log = createLogger('ilp-protocol-stream:Pool')

interface ConnectionEvent {
  (connection: Connection): void
}

type ConnectionOptions = Omit<BuildConnectionOpts, 'sharedSecret'>

export class ServerConnectionPool {
  private serverSecret: Buffer
  private connectionOpts: ConnectionOptions
  private onConnection: ConnectionEvent
  private activeConnections: { [id: string]: Connection }
  private pendingConnections: { [id: string]: Promise<Connection> }

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
  }

  async close (): Promise<void> {
    await Promise.all(Object.keys(this.activeConnections)
      .map((id: string) => this.activeConnections[id].end()))
  }

  async getConnection (
    id: string,
    prepare: IlpPacket.IlpPrepare
  ): Promise<Connection> {
    const activeConnection = this.activeConnections[id]
    if (activeConnection) return Promise.resolve(activeConnection)
    const pendingConnection = this.pendingConnections[id]
    if (pendingConnection) return pendingConnection

    const connectionPromise = (async () => {
      const token = Buffer.from(id, 'base64')
      const sharedSecret = await this.getSharedSecret(token, prepare)
      // If we get here, that means it was a token + sharedSecret we created
      let connectionTag: string | undefined
      let receiptNonce: Buffer | undefined
      let receiptSecret: Buffer | undefined
      const reader = new Reader(cryptoHelper.decryptConnectionAddressToken(this.serverSecret, token))
      reader.skipOctetString(cryptoHelper.TOKEN_NONCE_LENGTH)
      if (reader.peekVarOctetString().length) {
        connectionTag = reader.readVarOctetString().toString('ascii')
      } else {
        reader.skipVarOctetString()
      }
      switch (reader.peekVarOctetString().length) {
        case 0:
          reader.skipVarOctetString()
          break
        case 16:
          receiptNonce = reader.readVarOctetString()
          break
        default:
          throw new Error('receiptNonce must be 16 bytes')
      }
      switch (reader.peekVarOctetString().length) {
        case 0:
          reader.skipVarOctetString()
          break
        case 32:
          receiptSecret = reader.readVarOctetString()
          break
        default:
          throw new Error('receiptSecret must be 32 bytes')
      }
      const conn = await Connection.build({
        ...this.connectionOpts,
        sharedSecret,
        connectionTag,
        connectionId: id,
        receiptNonce,
        receiptSecret
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
    token: Buffer,
    prepare: IlpPacket.IlpPrepare
  ): Promise<Buffer> {
    try {
      const sharedSecret = cryptoHelper.generateSharedSecretFromToken(
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
