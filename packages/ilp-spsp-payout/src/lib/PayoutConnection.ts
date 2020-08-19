/* eslint-disable @typescript-eslint/no-use-before-define */
import { createConnection, Connection, DataAndMoneyStream } from 'ilp-protocol-stream'
import { URL } from 'url'
import axios from 'axios'

export const resolvePaymentPointer = (pointer: string) => {
  if (!pointer.startsWith('$')) {
    return pointer
  }

  const parsed = new URL('https://' + pointer.substring(1))

  if (parsed.pathname === '/') {
    parsed.pathname = '/.well-known/pay'
  }

  return parsed.href
}

export enum State {
  DISCONNECTED,
  CONNECTING,
  IDLE,
  SENDING,
  ABORTED,
}

export class PayoutConnection {
  private pointer: string
  private spspUrl: string
  private connection?: Connection
  private stream?: DataAndMoneyStream
  private slippage?: number
  private plugin: any

  private state = State.DISCONNECTED
  private closing = false
  private safeSendTimer?: NodeJS.Timer

  private retryInterval: number // milliseconds
  private retries = 0
  private maxRetries: number

  private target = 0
  private sent = 0

  constructor({
    pointer,
    plugin,
    slippage,
    retryInterval,
    maxRetries,
  }: {
    pointer: string
    plugin: any
    slippage?: number
    retryInterval: number
    maxRetries: number
  }) {
    this.pointer = pointer
    this.spspUrl = resolvePaymentPointer(pointer)
    this.plugin = plugin
    this.slippage = slippage
    this.retryInterval = retryInterval
    this.maxRetries = maxRetries
  }

  getDebugInfo() {
    return {
      state: this.state,
      target: this.target,
      sent: this.sent,
      currentStreamTotalSent: this.stream && this.stream.totalSent,
      pointer: this.pointer,
    }
  }

  send(amount: number) {
    if (this.closing) {
      throw new Error('payout connection is closing')
    }

    this.target += amount

    if ((this.getState() === State.SENDING || this.getState() === State.IDLE) && this.stream) {
      this.setState(State.SENDING)
      this.stream.setSendMax(this.getSendMax())
    } else {
      this.safeTrySending()
    }
  }

  isIdle() {
    return this.getState() === State.IDLE || this.getState() === State.ABORTED
  }

  async close() {
    this.closing = true
    if (this.safeSendTimer) {
      clearTimeout(this.safeSendTimer)
    }
    if (this.connection) {
      await this.connection.destroy()
    }
    await this.plugin.disconnect()
  }

  private async spspQuery() {
    const { data } = await axios({
      url: this.spspUrl,
      method: 'GET',
      headers: {
        accept: 'application/spsp4+json',
      },
    })

    return {
      destinationAccount: data.destination_account,
      sharedSecret: Buffer.from(data.shared_secret, 'base64'),
    }
  }

  private getSendMax() {
    return this.target - this.sent
  }

  // appeases type checker
  private getState() {
    return this.state
  }

  private setState(state: State) {
    this.state = state
  }

  private async safeTrySending() {
    if (this.retries++ >= this.maxRetries) {
      this.setState(State.ABORTED)
      console.warn(
        'aborted PayoutConnection pointer=%s target=%d sent=%d',
        this.pointer,
        this.target,
        this.sent
      )
      return
    }
    this.trySending().catch((err) => {
      if (this.closing) return
      // TODO: backoff
      this.setState(State.DISCONNECTED)
      this.safeSendTimer = setTimeout(() => {
        this.safeTrySending()
      }, this.retryInterval)
    })
  }

  private async trySending() {
    if (this.getState() !== State.DISCONNECTED) {
      return
    }

    this.setState(State.CONNECTING)

    const spspParams = await this.spspQuery()
    const connection = await createConnection({
      plugin: this.plugin,
      ...(this.slippage && { slippage: this.slippage }),
      ...spspParams,
    })

    const stream = connection.createStream()
    this.stream = stream
    this.connection = connection
    const sendMax = this.getSendMax()

    if (sendMax > 0) {
      this.setState(State.SENDING)
      stream.setSendMax(this.getSendMax())
    } else {
      this.setState(State.IDLE)
    }

    let appliedSent = false
    let totalStreamAmount = 0
    const cleanUp = () => {
      setImmediate(() => {
        this.setState(State.DISCONNECTED)

        stream.removeListener('close', onClose)
        stream.removeListener('error', onError)
        stream.removeListener('outgoing_money', onOutgoingMoney)
        connection.removeListener('close', onClose)
        connection.removeListener('error', onError)

        if (!appliedSent) {
          this.sent += totalStreamAmount
          appliedSent = true
        }

        if (this.getSendMax() > 0) {
          this.safeTrySending()
        }
      })
    }

    const onClose = () => cleanUp()
    const onError = () => cleanUp()
    const onOutgoingMoney = (amount: string) => {
      this.retries = 0
      totalStreamAmount += Number(amount)
      if (totalStreamAmount + this.sent >= this.target) {
        this.setState(State.IDLE)
      }
    }

    connection.on('close', onClose)
    connection.on('error', onError)
    stream.on('close', onClose)
    stream.on('error', onError)
    stream.on('outgoing_money', onOutgoingMoney)
  }
}
