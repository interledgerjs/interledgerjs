/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/explicit-module-boundary-types */
import { BackendInstance } from 'ilp-connector/dist/types/backend'
import { getRate, AssetPrices } from '../src/rates'
import { Injector } from 'reduct'
import Config from 'ilp-connector/dist/services/config'
import Accounts from 'ilp-connector/dist/services/accounts'

export class CustomBackend implements BackendInstance {
  protected deps: Injector

  protected prices: AssetPrices = {}
  protected spread?: number

  constructor(deps: Injector) {
    this.deps = deps
  }

  async getRate(sourceAccount: string, destinationAccount: string): Promise<number> {
    const sourceInfo = this.deps(Accounts).getInfo(sourceAccount)
    if (!sourceInfo) {
      throw new Error('unable to fetch account info for source account.')
    }

    const destInfo = this.deps(Accounts).getInfo(destinationAccount)
    if (!destInfo) {
      throw new Error('unable to fetch account info for destination account.')
    }

    const rate = getRate(
      sourceInfo.assetCode,
      sourceInfo.assetScale,
      destInfo.assetCode,
      destInfo.assetScale,
      this.prices
    )
    if (!rate) {
      throw new Error('Rate unavailable')
    }

    const spread = this.spread ?? this.deps(Config).spread ?? 0
    return rate * (1 - spread)
  }

  setPrices(prices: AssetPrices): void {
    this.prices = prices
  }

  setSpread(spread: number): void {
    this.spread = spread
  }

  async connect() {}
  async disconnect() {}
  async submitPacket() {}
  async submitPayment() {}
}
