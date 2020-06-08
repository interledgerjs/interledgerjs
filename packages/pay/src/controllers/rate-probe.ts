import { PaymentError } from '..'
import {
  StreamController,
  StreamRequestBuilder,
  ControllerMap,
  SendState,
  StreamRequest,
  StreamReply,
} from '.'
import { Int } from '../utils'
import { MaxPacketAmountController } from './max-packet'
import { PromiseResolver } from '../utils'
import { ExchangeRateController, ExchangeRateCalculator } from './exchange-rate'

// TODO Improve discovery of accurate exchange rates

export interface RateProbeOutcome {
  maxPacketAmount: Int
  rateCalculator: ExchangeRateCalculator
}

export class RateProbe implements StreamController {
  private static TIMEOUT_MS = 10000

  private status = new PromiseResolver<RateProbeOutcome>()

  private deadline?: number
  private controllers: ControllerMap
  private initialTestPacketAmounts = [
    0,
    1e12,
    1e11,
    1e10,
    1e9,
    1e8,
    1e7,
    1e6,
    1e5,
    1e4,
    1e3,
    100,
    10,
    1,
  ].map(Int.fromNumber)

  /** Amounts that are in flight */
  private inFlightAmounts = new Set<bigint>()

  /** Amounts sent that received an authentic reply */
  private ackedAmounts = new Set<bigint>()

  constructor(controllers: ControllerMap) {
    this.controllers = controllers
  }

  done(): Promise<RateProbeOutcome> {
    return this.status.promise
  }

  nextState(builder: StreamRequestBuilder): SendState | PaymentError {
    if (this.deadline && Date.now() > this.deadline) {
      return PaymentError.RateProbeFailed
    }

    const nextTestPacket = this.initialTestPacketAmounts[0]
    if (nextTestPacket) {
      builder.setSourceAmount(nextTestPacket).send()
      return SendState.Wait
    }

    // Max packet probe amount or discovered max packet amount
    const maxPacketAmount = this.controllers.get(MaxPacketAmountController).getMaxPacketAmount()

    const rateCalculator = this.controllers.get(ExchangeRateController).state
    const discoveredMaxPacket = this.controllers.get(MaxPacketAmountController).isPreciseMaxKnown()
    if (discoveredMaxPacket && rateCalculator && this.inFlightAmounts.size === 0) {
      this.status.resolve({
        maxPacketAmount,
        rateCalculator,
      })
      return SendState.End
    }

    if (
      !this.inFlightAmounts.has(maxPacketAmount.value) &&
      !this.ackedAmounts.has(maxPacketAmount.value)
    ) {
      builder.setSourceAmount(maxPacketAmount).send()
      return SendState.Wait
    }

    return SendState.Wait
  }

  applyRequest({ sourceAmount }: StreamRequest): (reply: StreamReply) => void {
    this.inFlightAmounts.add(sourceAmount.value)

    // Safe to mutate since the hardcoded amounts are used for all the earliest test packets
    this.initialTestPacketAmounts.shift()

    // Set deadline when the first test packet is sent
    if (!this.deadline) {
      this.deadline = Date.now() + RateProbe.TIMEOUT_MS
    }

    return (reply: StreamReply) => {
      this.inFlightAmounts.delete(sourceAmount.value)

      if (reply.isAuthentic()) {
        this.ackedAmounts.add(sourceAmount.value)
      }
    }
  }
}
