import { StreamController, StreamRequest, StreamRequestBuilder } from '.'
import { PaymentState } from '..'

/** Track the sequence number of outgoing packets */
export class SequenceController implements StreamController {
  static PACKET_LIMIT = 2 ** 32
  private nextSequence = 0

  nextState(builder: StreamRequestBuilder) {
    // Destroy the connection after 2^32 packets are sent for encryption safety:
    // https://github.com/interledger/rfcs/blob/master/0029-stream/0029-stream.md#513-maximum-number-of-packets-per-connection
    if (this.nextSequence >= SequenceController.PACKET_LIMIT) {
      // TODO Log here!
      builder.log.error('failed')
      return PaymentState.End
    }

    builder.setSequence(this.nextSequence)
    return PaymentState.SendMoney
  }

  applyPrepare(prepare: StreamRequest) {
    this.nextSequence = prepare.sequence + 1
  }
}
