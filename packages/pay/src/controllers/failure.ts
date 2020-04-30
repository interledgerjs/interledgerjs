import {
  StreamReject,
  StreamController,
  StreamRequestBuilder,
  StreamReply,
  StreamRequest,
  isFulfillable,
  SendState
} from '.'
import { Errors } from 'ilp-packet'
import { ILP_ERROR_CODES } from '../utils'
import {
  ConnectionCloseFrame,
  FrameType,
  ErrorCode,
  StreamCloseFrame,
  Frame
} from 'ilp-protocol-stream/dist/src/packet'
import { DEFAULT_STREAM_ID } from './amount'
import { Logger } from 'ilp-logger'

/** Controller to cancel a payment if no more money is fulfilled */
export class FailureController implements StreamController {
  /** Number of milliseconds since the last Fulfill was received before the payment should fail */
  private static MAX_DURATION_SINCE_LAST_FULFILL = 10000

  /** UNIX timestamp when the last Fulfill was received. Begins when the first fulfillable Prepare is sent */
  private lastFulfillTime?: number

  /** Should the payment end immediatey due to a terminal error? */
  private terminalFailure = false

  nextState({ log }: StreamRequestBuilder) {
    if (this.terminalFailure) {
      return SendState.End
    }

    if (this.lastFulfillTime) {
      const deadline = this.lastFulfillTime + FailureController.MAX_DURATION_SINCE_LAST_FULFILL
      if (Date.now() > deadline) {
        log.error(
          'ending payment: no Fulfill received before idle deadline. last fulfill: %s, deadline: %s',
          this.lastFulfillTime,
          deadline
        )
        return SendState.End
      }
    }

    return SendState.Ready
  }

  applyPrepare(request: StreamRequest) {
    if (isFulfillable(request)) {
      // After first fulfillable packet is sent, begin the timer
      // (So the rate probe doesn't end the payment)
      this.lastFulfillTime = Date.now()
    }
  }

  applyFulfill({ responseFrames, log }: StreamReply) {
    this.lastFulfillTime = Date.now()
    this.handleRemoteClose(responseFrames, log)
  }

  applyReject({ reject, responseFrames, log }: StreamReject) {
    this.handleRemoteClose(responseFrames, log)

    // Ignore all temporary errors, F08, F99, & R01
    if (reject.code[0] === 'T') {
      return
    }
    switch (reject.code) {
      case Errors.codes.F08_AMOUNT_TOO_LARGE:
      case Errors.codes.F99_APPLICATION_ERROR:
      case Errors.codes.R01_INSUFFICIENT_SOURCE_AMOUNT:
        return
    }

    // On any other error, end the payment
    this.terminalFailure = true
    log.error(
      'ending payment: got %s %s error. message: %s, triggered by: %s',
      reject.code,
      ILP_ERROR_CODES[reject.code],
      reject.message,
      reject.triggeredBy
    )
  }

  /**
   * End the payment if the receiver closed the connection or the stream used to send money.
   * Note: this is also called when we received incoming packets to check for close frames
   */
  handleRemoteClose(responseFrames?: Frame[], log?: Logger) {
    const closeFrame = responseFrames?.find(
      (frame): frame is ConnectionCloseFrame | StreamCloseFrame =>
        frame.type === FrameType.ConnectionClose ||
        (frame.type === FrameType.StreamClose && frame.streamId.equals(DEFAULT_STREAM_ID))
    )
    if (closeFrame) {
      log?.error(
        'ending payment: receiver closed the connection. error type: %s, message: %s',
        ErrorCode[closeFrame.errorCode],
        closeFrame.errorMessage
      )
      this.terminalFailure = true
    }
  }
}
