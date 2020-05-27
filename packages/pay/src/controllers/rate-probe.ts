import { PaymentError } from '..'
import {
  StreamController,
  StreamRequestBuilder,
  ControllerMap,
  SendState,
  StreamRequest,
  StreamReply,
  StreamReject,
  isFulfillable,
} from '.'
import { Integer } from '../utils'
import BigNumber from 'bignumber.js'
import { MaxPacketAmountController } from './max-packet'
import { Errors } from 'ilp-packet'

// TODO Need algo to discover the **best** exchange rate
// TODO Add backoff on temporary errors, e.g. T04s?

// TODO Is there a way for this to run passively in the background,
//      not just during a send loop?

export class RateProbe implements StreamController {
  private static TIMEOUT_MS = 10000

  private isDisabled = false
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

  /** Amounts queued to send or in-flight */
  private inFlightAmounts = new Set<string>()

  constructor(controllers: ControllerMap) {
    this.controllers = controllers
  }

  nextState(builder: StreamRequestBuilder): SendState | PaymentError {
    if (this.isDisabled) {
      return SendState.Ready
    }

    if (this.deadline && Date.now() > this.deadline) {
      return PaymentError.RateProbeFailed // TODO Replace with `SendState.End`?
    }

    // Apply the actual test packet amount, if we have one available
    const amount = this.remainingTestPacketAmounts[0]
    if (amount) {
      builder.setSourceAmount(amount as Integer)
      return SendState.Ready
    } else if (this.inFlightAmounts.size === 0) {
      // No in-flight pckaets and no test packets left to send
      return SendState.End
    } else {
      // Wait for in-flight requests to complete (we may need to send more)
      return SendState.Wait
    }
  }

  applyRequest(request: StreamRequest) {
    // Don't do anything if this isn't a probe packet
    if (isFulfillable(request) || this.isDisabled) {
      return () => {}
    }

    // Mutate the array to remove this test packet amount
    const { sourceAmount } = request
    this.remainingTestPacketAmounts.shift()
    this.inFlightAmounts.add(sourceAmount.toString())

    // Rate probe must complete before deadline
    if (!this.deadline) {
      this.deadline = Date.now() + RateProbe.TIMEOUT_MS
    }

    return (reply: StreamReply) => {
      this.inFlightAmounts.delete(sourceAmount.toString())

      // Note: we already checked that the request is unfulfillabe, so it must be a Reject
      const maxPacketController = this.controllers.get(MaxPacketAmountController)
      if (
        (reply as StreamReject).ilpReject.code === Errors.codes.F08_AMOUNT_TOO_LARGE ||
        !maxPacketController.isPreciseMaxKnown()
      ) {
        this.queueTestAmount()
      }
    }
  }

  private queueTestAmount() {
    const maxPacketProbeAmount = this.controllers
      .get(MaxPacketAmountController)
      .getMaxPacketAmount()
    if (!maxPacketProbeAmount) {
      return
    }

    if (this.inFlightAmounts.has(maxPacketProbeAmount.toString())) {
      return
    }

    this.inFlightAmounts.add(maxPacketProbeAmount.toString())
    this.remainingTestPacketAmounts.push(maxPacketProbeAmount)
  }

  disable() {
    this.isDisabled = true
  }
}
