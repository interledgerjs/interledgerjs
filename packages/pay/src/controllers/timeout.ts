import { StreamController, NextRequest, StreamReply, StreamRequest } from '.'
import { PaymentError } from '..'

// TODO Problem: this still enables the payment to go on indefinitely, which should probably be prevented...

export class TimeoutController implements StreamController {
  /** Number of milliseconds since the last Fulfill was received before the payment should fail */
  private static MAX_DURATION_SINCE_LAST_FULFILL = 10_000

  /** UNIX timestamp when the last Fulfill was received. Begins when the first fulfillable Prepare is sent */
  private fulfillDeadline?: number

  nextState(request: NextRequest): PaymentError | void {
    if (this.fulfillDeadline && Date.now() > this.fulfillDeadline) {
      request.log.error(
        'ending payment: no Fulfill received before idle deadline. deadline: %s',
        this.fulfillDeadline
      )
      request.addConnectionClose().send()
      return PaymentError.IdleTimeout
    }
  }

  applyRequest({ isFulfillable }: StreamRequest): (reply: StreamReply) => void {
    // Set the initial deadline after the first fulfillable packet is sent
    if (isFulfillable && !this.fulfillDeadline) {
      this.resetDeadline()
    }

    return (reply: StreamReply) => {
      if (reply.isFulfill()) {
        this.resetDeadline()
      }
    }
  }

  private resetDeadline(): void {
    this.fulfillDeadline = Date.now() + TimeoutController.MAX_DURATION_SINCE_LAST_FULFILL
  }
}
