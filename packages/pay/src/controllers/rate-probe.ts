import { PaymentError } from '..'
import { StreamController, ControllerMap, StreamRequest, StreamReply, NextRequest } from '.'
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
  private initialTestPacketAmounts = [
    0, // Asset request
    0, // Interledger.rs asset request
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
  ].map(Int.from)

  /** Amounts that are in flight */
  private inFlightAmounts = new Set<bigint>()

  /** Amounts sent that received an authentic reply */
  private ackedAmounts = new Set<bigint>()

  done(): Promise<RateProbeOutcome> {
    return this.status.promise
  }

  nextState(request: NextRequest, controllers: ControllerMap): PaymentError | void {
    if (this.deadline && Date.now() > this.deadline) {
      // TODO Log here!
      return PaymentError.RateProbeFailed
    }

    const knownMaxPacketAmount = controllers
      .get(MaxPacketAmountController)
      .getDiscoveredMaxPacketAmount()

    const nextTestPacket = this.initialTestPacketAmounts[0]

    // Send the next hardcoded test packet amount only if it's less than the already
    // established max packet amount
    if (
      nextTestPacket &&
      (!knownMaxPacketAmount || nextTestPacket.isLessThan(knownMaxPacketAmount))
    ) {
      return request.setSourceAmount(nextTestPacket).send()
    }

    // The rate probe is complete if we know the max packet amount, established a rate
    // TODO Should this finish even if packets are still in-flight?
    const rateCalculator = controllers.get(ExchangeRateController).state
    if (knownMaxPacketAmount && rateCalculator && this.inFlightAmounts.size === 0) {
      return this.status.resolve({
        maxPacketAmount: knownMaxPacketAmount,
        rateCalculator,
      })
    }

    const maxPacketProbeAmount = controllers.get(MaxPacketAmountController).getNextMaxPacketAmount()
    if (
      maxPacketProbeAmount &&
      !this.inFlightAmounts.has(maxPacketProbeAmount.value) &&
      !this.ackedAmounts.has(maxPacketProbeAmount.value)
    ) {
      return request.setSourceAmount(maxPacketProbeAmount).send()
    }
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
