import { StreamController } from '.'
import { StreamReceiptFrame, FrameType } from 'ilp-protocol-stream/dist/src/packet'
import { decodeReceipt, Receipt } from 'ilp-protocol-stream'
import { Int } from '../utils'
import { StreamReply } from '../request'

/** Controller to track the latest STREAM receipt for a third party to securely verify */
export class ReceiptController implements StreamController {
  /** Latest STREAM receipt, for the greatest amount, considered valid when it was received */
  private latestReceipt?: {
    totalReceived: Int
    buffer: Buffer
  }

  applyRequest(): (reply: StreamReply) => void {
    return (reply: StreamReply) => {
      // Check for receipt frame
      // No need to check streamId, since we only send over stream=1
      const receiptBuffer = reply.frames?.find(
        (frame): frame is StreamReceiptFrame => frame.type === FrameType.StreamReceipt
      )?.receipt
      if (!receiptBuffer) {
        return
      }

      // Decode receipt, discard if invalid
      let receipt: Receipt
      try {
        receipt = decodeReceipt(receiptBuffer)
      } catch (_) {
        return
      }

      const newTotalReceived = Int.from(receipt.totalReceived)
      if (!this.latestReceipt || newTotalReceived.isGreaterThan(this.latestReceipt.totalReceived)) {
        reply.log.debug('updated latest stream receipt for %s', newTotalReceived)
        this.latestReceipt = {
          totalReceived: newTotalReceived,
          buffer: receiptBuffer,
        }
      }
    }
  }

  getReceipt(): Buffer | undefined {
    return this.latestReceipt?.buffer
  }
}
