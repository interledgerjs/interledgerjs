import { PaymentError } from '..'
import {
  StreamController,
  StreamRequestBuilder,
  ControllerMap,
  SendState,
  StreamReject,
  StreamRequest,
  StreamReply,
} from '.'
import { Integer } from '../utils'
import BigNumber from 'bignumber.js'
import { MaxPacketAmountController } from './max-packet'
import { Errors } from 'ilp-packet'

// TODO What to do otherwise? Use max packet amount?
// TODO Need algo to discover the **best** exchange rate
// TODO Add backoff on temporary errors, e.g. T04s?

// TODO Is there a way for this to run passively in the background,
//      not just during a send loop?

export class RateProbe implements StreamController {
  private disabled = false
  private deadline?: number
  private controllers: ControllerMap
  private remainingTestPacketAmounts = [
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
    1e2,
    1e1,
    1,
  ].map((n) => new BigNumber(n))
  private inFlight = new Set<number>()

  constructor(controllers: ControllerMap) {
    this.controllers = controllers
  }

  nextState(builder: StreamRequestBuilder): SendState | PaymentError {
    if (this.disabled) {
      return SendState.Ready
    }

    if (this.deadline && Date.now() > this.deadline) {
      return PaymentError.RateProbeFailed
    }

    // Apply the actual test packet amount, if we have one available
    const amount = this.remainingTestPacketAmounts[0]
    if (amount) {
      builder.setSourceAmount(amount as Integer)
      return SendState.Ready
    } else if (this.inFlight.size === 0) {
      // No in-flight pckaets and no test packets left to send
      return SendState.End
    } else {
      // Wait for in-flight requests to complete (we may need to send more)
      return SendState.Wait
    }
  }

  applyPrepare({ sequence }: StreamRequest) {
    // Mutate the array to remove this test packet amount
    this.remainingTestPacketAmounts.shift()
    this.inFlight.add(sequence)

    if (!this.deadline) {
      this.deadline = Date.now() + 10000 // TODO Create constant
    }
  }

  applyFulfill({ sequence }: StreamReply) {
    this.inFlight.delete(sequence)
  }

  applyReject({ reject, sequence }: StreamReject) {
    // Keep retrying on F08s until we can get packets through
    if (reject.code === Errors.codes.F08_AMOUNT_TOO_LARGE) {
      const maxPacketProbeAmount = this.controllers
        .get(MaxPacketAmountController)
        .getMaxPacketAmount()
      if (maxPacketProbeAmount) {
        this.remainingTestPacketAmounts.push(maxPacketProbeAmount)
      }
    }

    this.inFlight.delete(sequence)
  }

  disable() {
    this.disabled = true
  }
}
