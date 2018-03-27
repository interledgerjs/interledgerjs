import EventEmitter3 = require('eventemitter3')
import * as ILDCP from 'ilp-protocol-ildcp'
import * as IlpPacket from 'ilp-packet'
import * as Debug from 'debug'
import * as cryptoHelper from './crypto'
import { Connection } from './connection'
import { Plugin } from './types'
import 'source-map-support/register'

export interface CreateConnectionOpts {
  plugin: Plugin,
  destinationAccount: string,
  sharedSecret: Buffer
}

export async function createConnection (opts: CreateConnectionOpts): Promise<Connection> {
  await opts.plugin.connect()
  const sourceAccount = (await ILDCP.fetch(opts.plugin.sendData.bind(opts.plugin))).clientAddress
  const connection = new Connection({
    plugin: opts.plugin,
    destinationAccount: opts.destinationAccount,
    sourceAccount,
    sharedSecret: opts.sharedSecret,
    isServer: false
  })
  opts.plugin.registerDataHandler(async (data: Buffer): Promise<Buffer> => {
    let prepare: IlpPacket.IlpPrepare
    try {
      prepare = IlpPacket.deserializeIlpPrepare(data)
    } catch (err) {
      this.debug(`got data that is not an ILP Prepare packet: ${data.toString('hex')}`)
      throw new IlpPacket.Errors.BadRequestError('Expected an ILP Prepare packet')
    }

    try {
      const fulfill = await connection.handlePrepare(prepare)
      return IlpPacket.serializeIlpFulfill(fulfill)
    } catch (err) {
      if (!err.ilpErrorCode) {
        this.debug('error handling prepare:', err)
      }
      // TODO should the default be F00 or T00?
      return IlpPacket.serializeIlpReject({
        code: err.ilpErrorCode || 'F00',
        message: err.ilpErrorMessage || '',
        data: err.ilpErrorData || Buffer.alloc(0),
        triggeredBy: sourceAccount
      })
    }
  })
  connection.connect()
  // TODO resolve only when it is connected
  return connection
}

export interface ServerOpts {
  serverSecret: Buffer,
  plugin: Plugin
}

export class Server extends EventEmitter3 {
  protected serverSecret: Buffer
  protected plugin: Plugin
  protected sourceAccount: string
  protected connections: { [key: string]: Connection }
  protected debug: Debug.IDebugger

  constructor (opts: ServerOpts) {
    super()
    this.serverSecret = opts.serverSecret
    this.plugin = opts.plugin
    this.debug = Debug('ilp-protocol-stream:Server')
    this.connections = {}
  }

  async listen (): Promise<void> {
    this.plugin.registerDataHandler(this.handleData.bind(this))
    await this.plugin.connect()
    this.sourceAccount = (await ILDCP.fetch(this.plugin.sendData.bind(this.plugin))).clientAddress
  }

  async acceptConnection (): Promise<Connection> {
    /* tslint:disable-next-line:no-unnecessary-type-assertion */
    return new Promise((resolve, reject) => {
      this.once('connection', resolve)
    }) as Promise<Connection>
  }

  generateAddressAndSecret (): { destinationAccount: string, sharedSecret: Buffer } {
    const { token, sharedSecret } = cryptoHelper.generateTokenAndSharedSecret(this.serverSecret)
    return {
      destinationAccount: `${this.sourceAccount}.${base64url(token)}`,
      sharedSecret
    }
  }

  protected async handleData (data: Buffer): Promise<Buffer> {
    try {
      let prepare: IlpPacket.IlpPrepare
      try {
        prepare = IlpPacket.deserializeIlpPrepare(data)
      } catch (err) {
        this.debug(`got data that is not an ILP Prepare packet: ${data.toString('hex')}`)
        throw new IlpPacket.Errors.BadRequestError('Expected an ILP Prepare packet')
      }

      const localAddressParts = prepare.destination.replace(this.sourceAccount + '.', '').split('.')
      if (localAddressParts.length === 0 || !localAddressParts[0]) {
        this.debug(`destination in ILP Prepare packet does not have a Connection ID: ${prepare.destination}`)
        throw new IlpPacket.Errors.UnreachableError('')
      }
      const connectionId = localAddressParts[0]

      if (!this.connections[connectionId]) {
        try {
          const token = Buffer.from(connectionId, 'base64')
          const sharedSecret = cryptoHelper.generateSharedSecretFromToken(this.serverSecret, token)
          cryptoHelper.decrypt(sharedSecret, prepare.data)

          // If we get here, that means it was a token + sharedSecret we created
          const connection = new Connection({
            plugin: this.plugin,
            sourceAccount: this.sourceAccount,
            sharedSecret,
            isServer: true
          })
          this.connections[connectionId] = connection
          this.debug(`got incoming packet for new connection: ${connectionId}`)
          this.emit('connection', connection)

          // Wait for the next tick of the event loop before handling the prepare
          await new Promise((resolve, reject) => setImmediate(resolve))
        } catch (err) {
          this.debug(`got prepare for an address and token that we did not generate: ${prepare.destination}`)
          throw new IlpPacket.Errors.UnreachableError('')
        }
      }

      const fulfill = await this.connections[connectionId].handlePrepare(prepare)
      return IlpPacket.serializeIlpFulfill(fulfill)

    } catch (err) {
      if (!err.ilpErrorCode) {
        this.debug('error handling prepare:', err)
      }
      // TODO should the default be F00 or T00?
      return IlpPacket.serializeIlpReject({
        code: err.ilpErrorCode || 'F00',
        message: err.ilpErrorMessage || '',
        data: err.ilpErrorData || Buffer.alloc(0),
        triggeredBy: this.sourceAccount
      })
    }
  }
}

function base64url (buffer: Buffer) {
  return buffer.toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}
