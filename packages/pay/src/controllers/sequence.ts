import { StreamController } from '.'
import { PaymentError } from '..'
import { StreamRequest, RequestBuilder } from '../request'

/** Track the sequence number of outgoing packets */
export class SequenceController implements StreamController {
  private static PACKET_LIMIT = 2 ** 31
  private nextSequence = 0

  nextState(request: StreamRequest): StreamRequest | PaymentError {
    // Destroy the connection after 2^31 packets are sent for encryption safety:
    // https://github.com/interledger/rfcs/blob/master/0029-stream/0029-stream.md#513-maximum-number-of-packets-per-connection
    if (this.nextSequence >= SequenceController.PACKET_LIMIT) {
      request.log.error('ending payment: cannot exceed max safe sequence number.')
      return PaymentError.ExceededMaxSequence
    } else {
      return new RequestBuilder(request).setSequence(this.nextSequence).build()
    }
  }

  applyRequest(request: StreamRequest): undefined {
    this.nextSequence = request.sequence + 1
    return // Required by TS for `undefined` return type
  }
}
