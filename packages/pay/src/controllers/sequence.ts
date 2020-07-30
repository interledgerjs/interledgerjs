import { StreamController, StreamRequest, NextRequest } from '.'
import { PaymentError } from '..'

/** Track the sequence number of outgoing packets */
export class SequenceController implements StreamController {
  private static PACKET_LIMIT = 2 ** 32
  private nextSequence = 0

  nextState(request: NextRequest): PaymentError | void {
    request.setSequence(this.nextSequence)

    // Destroy the connection after 2^32 packets are sent for encryption safety:
    // https://github.com/interledger/rfcs/blob/master/0029-stream/0029-stream.md#513-maximum-number-of-packets-per-connection
    if (this.nextSequence >= SequenceController.PACKET_LIMIT) {
      request.log.error('ending payment: cannot exceed max safe sequence number.')
      return PaymentError.ExceededMaxSequence
    }
  }

  applyRequest(request: StreamRequest): void {
    this.nextSequence = request.sequence + 1
  }
}
