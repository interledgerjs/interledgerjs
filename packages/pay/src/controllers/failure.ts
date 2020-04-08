import { PaymentState } from '../'
import { StreamReject, StreamController, StreamRequestBuilder } from '.'
import { Errors } from 'ilp-packet'
import { ILP_ERROR_CODES } from '../send-packet'

// TODO Add additional behavior? If > 99% of the *last* 200 packets failed (?), then fail "fast"?

// TODO Make this configurable?
const MAX_DURATION_SINCE_LAST_FULFILL = 35000

/** Controller to cancel a payment if no more money is fulfilled */
export class FailureController implements StreamController {
  private lastFulfillTime = Date.now()
  private encounteredFinalError = false

  nextState({ log }: StreamRequestBuilder) {
    const deadline = this.lastFulfillTime + MAX_DURATION_SINCE_LAST_FULFILL
    if (Date.now() > deadline) {
      log.error(
        'ending payment: no Fulfill received before idle deadline. last fulfill: %s, deadline: %s',
        this.lastFulfillTime,
        deadline
      )
      return PaymentState.End
    }

    if (this.encounteredFinalError) {
      return PaymentState.End
    }

    return PaymentState.SendMoney
  }

  applyFulfill() {
    this.lastFulfillTime = Date.now()
  }

  applyReject({ reject, log }: StreamReject) {
    // Ignore all temporary errors
    if (reject.code[0] === 'T') {
      return
    }

    switch (reject.code) {
      case Errors.codes.F08_AMOUNT_TOO_LARGE:
      case Errors.codes.F99_APPLICATION_ERROR:
      case Errors.codes.R01_INSUFFICIENT_SOURCE_AMOUNT:
        return
    }

    this.encounteredFinalError = true
    log.error(
      'ending payment: got %s %s error. message: %s, triggered by: %s',
      reject.code,
      ILP_ERROR_CODES[reject.code],
      reject.message,
      reject.triggeredBy
    )
  }
}
