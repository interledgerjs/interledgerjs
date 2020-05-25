import {
  StreamController,
  StreamRequestBuilder,
  StreamReply,
  StreamRequest,
  isFulfillable,
  SendState,
} from '.'
import { Errors } from 'ilp-packet'
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

/** Controller to cancel a payment if no more money is fulfilled */
export class FailureController implements StreamController {
  /** Number of milliseconds since the last Fulfill was received before the payment should fail */
  private static MAX_DURATION_SINCE_LAST_FULFILL = 10000

  /** UNIX timestamp when the last Fulfill was received. Begins when the first fulfillable Prepare is sent */
  private lastFulfillTime?: number

  /** Should the payment end immediatey due to a terminal error? */
  private terminalReject = false

  /** Was the connection or stream closed by the recipient? */
  private remoteClosed = false

  nextState({ log }: StreamRequestBuilder) {
    if (this.terminalReject) {
      return PaymentError.TerminalReject
    }

    if (this.remoteClosed) {
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
        return PaymentError.IdleTimeout
      }
    }

    return SendState.Ready
  }

  applyRequest(request: StreamRequest) {
    // Initialize timer when first fulfillable packet is sent
    // so the rate probe doesn't trigger an idle timeout
    if (!this.lastFulfillTime && isFulfillable(request)) {
      this.lastFulfillTime = Date.now()
    }

    return (reply: StreamReply) => {
      const frames = reply.frames
      if (frames) {
        this.handleRemoteClose(frames, request.log)
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
          case Errors.codes.F08_AMOUNT_TOO_LARGE:
          case Errors.codes.F99_APPLICATION_ERROR:
          case Errors.codes.R01_INSUFFICIENT_SOURCE_AMOUNT:
            return
        }

        // On any other error, end the payment
        this.terminalReject = true
        request.log.error(
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
  handleRemoteClose(responseFrames: Frame[], log: Logger) {
    const closeFrame = responseFrames?.find(
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
