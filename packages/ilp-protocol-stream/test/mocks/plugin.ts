import { EventEmitter } from 'events'
import * as IlpPacket from 'ilp-packet'
import BigNumber from 'bignumber.js'
import * as ILDCP from 'ilp-protocol-ildcp'
import { Writer } from 'oer-utils'
require('source-map-support').install()

export interface DataHandler {
  (data: Buffer): Promise<Buffer>
}
export interface MoneyHandler {
  (amount: string): Promise<void>
}

export default class MockPlugin extends EventEmitter {
  static readonly version = 2
  public dataHandler: DataHandler
  public moneyHandler: MoneyHandler
  public exchangeRate: number
  public connected: boolean
  public mirror: MockPlugin
  protected identity: string
  public maxAmount?: number

  constructor (exchangeRate: number, mirror?: MockPlugin) {
    super()

    this.dataHandler = this.defaultDataHandler
    this.moneyHandler = this.defaultMoneyHandler
    this.exchangeRate = exchangeRate
    this.mirror = mirror || new MockPlugin(1 / exchangeRate, this)
    this.identity = (mirror ? 'peerB' : 'peerA')
    this.maxAmount = 1000
  }

  async connect () {
    this.connected = true
    return Promise.resolve()
  }

  async disconnect () {
    this.emit('disconnect')
    this.connected = false
    return Promise.resolve()
  }

  isConnected () {
    return this.connected
  }

  async sendData (data: Buffer): Promise<Buffer> {
    if (data[0] === IlpPacket.Type.TYPE_ILP_PREPARE) {
      const parsed = IlpPacket.deserializeIlpPrepare(data)
      if (parsed.destination === 'peer.config') {
        return ILDCP.serializeIldcpResponse({
          clientAddress: 'test.' + this.identity,
          assetScale: 9,
          assetCode: 'ABC'
        })
      }
      const amount = new BigNumber(parsed.amount)
      if (typeof this.maxAmount === 'number' && amount.isGreaterThan(this.maxAmount)) {
        const writer = new Writer()
        writer.writeUInt64(amount.toNumber())
        writer.writeUInt64(this.maxAmount)
        return IlpPacket.serializeIlpReject({
          code: 'F08',
          message: 'Packet amount too large',
          triggeredBy: 'test.connector',
          data: writer.getBuffer()
        })
      }
      const newPacket = IlpPacket.serializeIlpPrepare({
        ...parsed,
        amount: amount.times(this.exchangeRate).toString(10)
      })
      return this.mirror.dataHandler(newPacket)
    } else {
      return this.mirror.dataHandler(data)
    }
  }

  async sendMoney (amount: string): Promise<void> {
    return this.mirror.moneyHandler(amount)
  }

  registerDataHandler (handler: DataHandler): void {
    this.dataHandler = handler
  }

  deregisterDataHandler (): void {
    this.dataHandler = this.defaultDataHandler
  }

  registerMoneyHandler (handler: MoneyHandler): void {
    this.moneyHandler = handler
  }

  deregisterMoneyHandler (): void {
    this.moneyHandler = this.defaultMoneyHandler
  }

  async defaultDataHandler (data: Buffer): Promise<Buffer> {
    return IlpPacket.serializeIlpReject({
      code: 'F02', // Unreachable
      triggeredBy: 'example.mock-plugin',
      message: 'No data handler registered',
      data: Buffer.alloc(0)
    })
  }

  async defaultMoneyHandler (amount: string): Promise<void> {
    return
  }
}
