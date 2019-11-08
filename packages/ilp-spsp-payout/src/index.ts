/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-var-requires */
import { PayoutConnection } from './lib/PayoutConnection'
import { pluginFromEnvironment as makeIlpPlugin, Plugin } from 'ilp-plugin'

const CLEANUP_TIMEOUT = 30 * 1000

interface PayoutOpts {
  makePlugin?: () => Plugin
}

export class Payout {
  private createPlugin: () => Plugin
  private payouts: {
    [pointer: string]: {
      connection: PayoutConnection,
      lastSent: number,
      timer: NodeJS.Timer
    }
  }

  constructor (opts?: PayoutOpts) {
    if (opts && opts.makePlugin) {
      this.createPlugin = opts.makePlugin
    } else {
      this.createPlugin = makeIlpPlugin
    }
    this.payouts = {}
  }

  getPayout (paymentPointer: string) {
    return this.payouts[paymentPointer]
  }

  send (paymentPointer: string, amount: number) {
    if (!this.payouts[paymentPointer]) {
      this.payouts[paymentPointer] = {
        connection: new PayoutConnection({
          pointer: paymentPointer,
          plugin: this.createPlugin()
        }),
        lastSent: Date.now(),
        timer: this.makeTimer(paymentPointer, CLEANUP_TIMEOUT)
      }
    } else {
      this.payouts[paymentPointer].lastSent = Date.now()
    }

    this.payouts[paymentPointer]
      .connection
      .send(amount)
  }

  private async expirePaymentPointer (paymentPointer: string) {
    const payout = this.payouts[paymentPointer]
    if (!payout) {
      return
    }

    const isExpired = Date.now() - payout.lastSent > CLEANUP_TIMEOUT
    const isIdle = payout.connection.isIdle()

    if (isExpired) {
      if (!isIdle) {
        console.error('closing payout that was not idle.',
          JSON.stringify(payout.connection.getDebugInfo()))
      }

      delete this.payouts[paymentPointer]
      await payout.connection.close()
    } else {
      const msUntilExpiry = CLEANUP_TIMEOUT - (Date.now() - payout.lastSent)
      this.makeTimer(paymentPointer, msUntilExpiry)
    }
  }

  private makeTimer (paymentPointer: string, duration: number) {
    return setTimeout(() => {
      this.expirePaymentPointer(paymentPointer).catch((e: Error) => {
        console.error('failed to clean up payout.', e)
      })
    }, duration)
  }
}
