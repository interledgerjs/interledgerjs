import { PayoutConnection } from './lib/PayoutConnection'
import { Logger, defaultLogger } from './lib/Logger'
import { pluginFromEnvironment as makeIlpPlugin, Plugin } from 'ilp-plugin'

const CLEANUP_TIMEOUT = 30 * 1000

interface PayoutOpts {
  makePlugin?: () => Plugin
  slippage?: number
  retryInterval?: number // milliseconds
  maxRetries?: number // counter resets any time money is successfuly sent
  logger?: Logger
}

export class Payout {
  private createPlugin: () => Plugin
  private slippage?: number
  private payouts: {
    [pointer: string]: {
      connection: PayoutConnection
      lastSent: number
      timer: NodeJS.Timer
    }
  }
  private retryInterval: number
  private maxRetries: number
  private logger: Logger

  constructor(opts?: PayoutOpts) {
    if (opts && opts.makePlugin) {
      this.createPlugin = opts.makePlugin
    } else {
      this.createPlugin = makeIlpPlugin
    }
    this.payouts = {}
    this.slippage = opts && opts.slippage
    this.retryInterval = (opts && opts.retryInterval) || 5000
    this.maxRetries = (opts && opts.maxRetries) || 20
    this.logger = (opts && opts.logger) || defaultLogger
  }

  getPayout(paymentPointer: string) {
    return this.payouts[paymentPointer]
  }

  send(paymentPointer: string, amount: number): void {
    if (!this.payouts[paymentPointer]) {
      this.payouts[paymentPointer] = {
        connection: new PayoutConnection({
          pointer: paymentPointer,
          plugin: this.createPlugin(),
          slippage: this.slippage,
          retryInterval: this.retryInterval,
          maxRetries: this.maxRetries,
        }),
        lastSent: Date.now(),
        timer: this.makeTimer(paymentPointer, CLEANUP_TIMEOUT),
      }
    } else {
      this.payouts[paymentPointer].lastSent = Date.now()
    }

    this.payouts[paymentPointer].connection.send(amount)
  }

  private async expirePaymentPointer(paymentPointer: string) {
    const payout = this.payouts[paymentPointer]
    if (!payout) {
      return
    }

    const isExpired = Date.now() - payout.lastSent > CLEANUP_TIMEOUT
    const isIdle = payout.connection.isIdle()

    if (isExpired) {
      if (!isIdle) {
        this.logger.error(
          'closing payout that was not idle. info="%s"',
          JSON.stringify(payout.connection.getDebugInfo())
        )
      }

      delete this.payouts[paymentPointer]
      await payout.connection.close()
    } else {
      const msUntilExpiry = CLEANUP_TIMEOUT - (Date.now() - payout.lastSent)
      this.makeTimer(paymentPointer, msUntilExpiry)
    }
  }

  private makeTimer(paymentPointer: string, duration: number) {
    return setTimeout(() => {
      this.expirePaymentPointer(paymentPointer).catch((e: Error) => {
        this.logger.error('failed to clean up payout. err="%s"', e)
      })
    }, duration)
  }
}
