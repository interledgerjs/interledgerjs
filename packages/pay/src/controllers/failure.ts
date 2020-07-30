import { StreamController, StreamReply, StreamRequest, NextRequest } from '.'
import {
  ConnectionCloseFrame,
  FrameType,
  ErrorCode,
  StreamCloseFrame,
  Frame,
} from 'ilp-protocol-stream/dist/src/packet'
import { DEFAULT_STREAM_ID } from './payment'
import { Logger } from 'ilp-logger'
import { PaymentError } from '..'
import { IlpError } from 'ilp-packet'

/** Controller to cancel a payment if no more money is fulfilled */
export class FailureController implements StreamController {
  /** Should the payment end immediatey due to a terminal error? */
  private terminalReject = false

  /** Was the connection or stream closed by the recipient? */
  private remoteClosed = false

  nextState(request: NextRequest): PaymentError | void {
    if (this.terminalReject) {
      request.addConnectionClose().send()
      return PaymentError.ConnectorError
    }

    if (this.remoteClosed) {
      request.addConnectionClose().send()
      return PaymentError.ClosedByRecipient
    }
  }

  applyRequest({ log, requestFrames }: StreamRequest): (reply: StreamReply) => void {
    return (reply: StreamReply) => {
      const frames = reply.frames
      if (frames) {
        this.handleRemoteClose(frames, log)
      }

      if (reply.isReject()) {
        const { code } = reply.ilpReject

        // Ignore the error if the request included a `ConnectionNewAddress` frame,
        // since a Final Reject may be expected (refer to explanation in account controller)
        if (requestFrames.some((frame) => frame.type === FrameType.ConnectionNewAddress)) {
          log.trace('ignoring %s reject in reply to asset details request.', code)
          return
        }

        if (code[0] === 'T') {
          // Ignore all temporary errors, F08, F99, & R01
          return
        }
        switch (code) {
          case IlpError.F08_AMOUNT_TOO_LARGE:
          case IlpError.F99_APPLICATION_ERROR:
          case IlpError.R01_INSUFFICIENT_SOURCE_AMOUNT:
            return
        }

        // On any other error, end the payment immediately
        this.terminalReject = true
        log.error('ending payment from %s error.', code)
      }
    }
  }

  /** End the payment if the receiver closed the connection or the stream used to send money */
  private handleRemoteClose(responseFrames: Frame[], log: Logger): void {
    const closeFrame = responseFrames.find(
      (frame): frame is ConnectionCloseFrame | StreamCloseFrame =>
        frame.type === FrameType.ConnectionClose ||
        (frame.type === FrameType.StreamClose && frame.streamId.equals(DEFAULT_STREAM_ID))
    )
    if (closeFrame) {
      log.error(
        'ending payment: receiver closed the connection. error type: %s, message: %s',
        ErrorCode[closeFrame.errorCode],
        closeFrame.errorMessage
      )
      this.remoteClosed = true
    }
  }
}
