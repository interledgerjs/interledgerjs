import { StreamController, StreamRequestBuilder, StreamReply, StreamRequest, SendState } from '.'
import { ILP_ERROR_CODES } from '../utils'
import {
  ConnectionCloseFrame,
  FrameType,
  ErrorCode,
  StreamCloseFrame,
  Frame,
} from 'ilp-protocol-stream/dist/src/packet'
import { DEFAULT_STREAM_ID } from './amount'
import { Logger } from 'ilp-logger'
import { PaymentError } from '..'
import { IlpError } from 'ilp-packet'

/** Controller to cancel a payment if no more money is fulfilled */
export class FailureController implements StreamController {
  /** Number of milliseconds since the last Fulfill was received before the payment should fail */
  private static MAX_DURATION_SINCE_LAST_FULFILL = 10_000

  /** UNIX timestamp when the last Fulfill was received. Begins when the first fulfillable Prepare is sent */
  private lastFulfillTime?: number

  /** Should the payment end immediately due to a terminal error? */
  private terminalReject = false

  /** Was the connection or stream closed by the recipient? */
  private remoteClosed = false

  nextState(builder: StreamRequestBuilder): SendState | PaymentError {
    const { log } = builder

    if (this.terminalReject) {
      builder.sendConnectionClose()
      return PaymentError.ConnectorError
    }

    if (this.remoteClosed) {
      builder.sendConnectionClose()
      return PaymentError.ClosedByRecipient
    }

    if (this.lastFulfillTime) {
      const deadline = this.lastFulfillTime + FailureController.MAX_DURATION_SINCE_LAST_FULFILL
      if (Date.now() > deadline) {
        log.error(
          'ending payment: no Fulfill received before idle deadline. last fulfill: %s, deadline: %s',
          this.lastFulfillTime,
          deadline
        )
        builder.sendConnectionClose()
        return PaymentError.IdleTimeout
      }
    }

    return SendState.Ready
  }

  applyRequest({ log, isFulfillable }: StreamRequest): (reply: StreamReply) => void {
    // Initialize timer when first fulfillable packet is sent
    // so the rate probe doesn't trigger an idle timeout
    if (!this.lastFulfillTime && isFulfillable) {
      this.lastFulfillTime = Date.now()
    }

    return (reply: StreamReply) => {
      const frames = reply.frames
      if (frames) {
        this.handleRemoteClose(frames, log)
      }

      if (reply.isFulfill()) {
        this.lastFulfillTime = Date.now()
      }

      if (reply.isReject()) {
        const { code, message, triggeredBy } = reply.ilpReject

        // Ignore all temporary errors, F08, F99, & R01
        if (code[0] === 'T') {
          return
        }
        switch (code) {
          case IlpError.F08_AMOUNT_TOO_LARGE:
          case IlpError.F99_APPLICATION_ERROR:
          case IlpError.R01_INSUFFICIENT_SOURCE_AMOUNT:
            return
        }

        // TODO F02, R00 (and maybe even F00) tend to be routing errors.
        //      Should it tolerate a few of these before ending the payment?
        //      Timeout error could be a routing loop though?

        // On any other error, end the payment immediately
        this.terminalReject = true
        log.error(
          'ending payment: got %s %s error. message: %s, triggered by: %s',
          code,
          ILP_ERROR_CODES[code],
          message,
          triggeredBy
        )
      }
    }
  }

  /**
   * End the payment if the receiver closed the connection or the stream used to send money.
   * Note: this is also called when we received incoming packets to check for close frames
   */
  handleRemoteClose(responseFrames: Frame[], log: Logger): void {
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
