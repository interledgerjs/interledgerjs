import { StreamController, StreamRequest, StreamRequestBuilder } from '.'
import { PaymentState } from '..'

/** Track the sequence number of outgoing packets */
export class SequenceController implements StreamController {
  private static PACKET_LIMIT = 2 ** 32
  private nextSequence = 0

  // TODO How does the connection close frame interact with this?

  nextState(builder: StreamRequestBuilder) {
    builder.setSequence(this.nextSequence)

    // Destroy the connection after 2^32 packets are sent for encryption safety:
    // https://github.com/interledger/rfcs/blob/master/0029-stream/0029-stream.md#513-maximum-number-of-packets-per-connection
    if (this.nextSequence >= SequenceController.PACKET_LIMIT) {
      builder.log.error('ending payment: cannot exceed max safe sequence number.')
      return PaymentState.End
    }

    return PaymentState.SendMoney
  }

  applyPrepare(prepare: StreamRequest) {
    this.nextSequence = prepare.sequence + 1
  }
}
