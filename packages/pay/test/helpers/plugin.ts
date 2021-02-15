/* eslint-disable @typescript-eslint/no-empty-function */
import { DataHandler, PluginInstance } from 'ilp-connector/dist/types/plugin'
import { EventEmitter } from 'events'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { sleep } from '../../src/utils'
import { IlpPrepare, IlpReply } from 'ilp-packet'

type Middleware = (prepare: IlpPrepare) => Promise<IlpReply>

// sendIlpPrepare = createPipeline(RateMiddleware, LatencyMiddleware, MaxPacketMiddleware, TimeoutMiddleware)
// plugin = createPlugin( sendIlpPrepare )

// TODO Alternatively... just create "RateMiddleware" ... "LatencyMiddleware" ... "MaxPacketMiddleware" ?
// TODO Normal distribution
//      Cite this: https://stackoverflow.com/questions/25582882/javascript-math-random-normal-distribution-gaussian-bell-curve
const getRandomFloat = (min: number, max: number): number => {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random() // Converting [0,1) to (0,1)
  while (v === 0) v = Math.random()
  let num = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  num = num / 10 + 0.5 // Translate to 0 -> 1
  if (num > 1 || num < 0) return getRandomFloat(min, max) // Resample between 0 and 1
  num *= max - min
  num += min
  return num
}

const defaultDataHandler = async (): Promise<never> => {
  throw new Error('No data handler registered')
}

export class MirrorPlugin extends EventEmitter implements Plugin, PluginInstance {
  public mirror?: MirrorPlugin

  public dataHandler: DataHandler = defaultDataHandler

  private readonly minNetworkLatency: number
  private readonly maxNetworkLatency: number

  constructor(minNetworkLatency = 10, maxNetworkLatency = 50) {
    super()
    this.minNetworkLatency = minNetworkLatency
    this.maxNetworkLatency = maxNetworkLatency
  }

  static createPair(
    minNetworkLatency?: number,
    maxNetworkLatency?: number
  ): [MirrorPlugin, MirrorPlugin] {
    const pluginA = new MirrorPlugin(minNetworkLatency, maxNetworkLatency)
    const pluginB = new MirrorPlugin(minNetworkLatency, maxNetworkLatency)

    pluginA.mirror = pluginB
    pluginB.mirror = pluginA

    return [pluginA, pluginB]
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  isConnected(): boolean {
    return true
  }

  async sendData(data: Buffer): Promise<Buffer> {
    if (this.mirror) {
      await this.addNetworkDelay()
      const response = await this.mirror.dataHandler(data)
      await this.addNetworkDelay()
      return response
    } else {
      throw new Error('Not connected')
    }
  }

  registerDataHandler(handler: DataHandler): void {
    this.dataHandler = handler
  }

  deregisterDataHandler(): void {
    this.dataHandler = defaultDataHandler
  }

  async sendMoney(): Promise<void> {}

  registerMoneyHandler(): void {}

  deregisterMoneyHandler(): void {}

  private async addNetworkDelay() {
    await sleep(getRandomFloat(this.minNetworkLatency, this.maxNetworkLatency))
  }
}
