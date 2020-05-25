import { BackendInstance } from 'ilp-connector/dist/types/backend'
import { AccountInfo } from 'ilp-connector/dist/types/accounts'
import { getRate, AssetPrices } from '../src/rates'
import { Injector } from 'reduct'
import Config from 'ilp-connector/dist/services/config'
import Accounts from 'ilp-connector/dist/services/accounts'

export class CustomBackend implements BackendInstance {
  protected getPrices: () => AssetPrices
  protected getSpread: () => number
  protected getInfo: (accountId: string) => AccountInfo | undefined

  constructor(deps: Injector) {
    const config = deps(Config)
    const accounts = deps(Accounts)

    this.getPrices = () => (config.backendConfig ? config.backendConfig.prices : {})
    this.getSpread = () => config.spread ?? 0
    this.getInfo = (account: string) => accounts.getInfo(account)
  }

  async getRate(sourceAccount: string, destinationAccount: string) {
    const sourceInfo = this.getInfo(sourceAccount)
    if (!sourceInfo) {
      throw new Error('unable to fetch account info for source account.')
    }

    const destInfo = this.getInfo(destinationAccount)
    if (!destInfo) {
      throw new Error('unable to fetch account info for destination account.')
    }

    const rate = getRate(
      sourceInfo.assetCode,
      sourceInfo.assetScale,
      destInfo.assetCode,
      destInfo.assetScale,
      this.getPrices()
    )
    if (!rate) {
      throw new Error('Rate unavailable')
    }

    return rate.toNumber() * (1 - this.getSpread())
  }

  async connect() {}
  async disconnect() {}
  async submitPacket() {}
  async submitPayment() {}
}
