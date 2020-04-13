import { IlpReject } from 'ilp-packet'
import { Frame } from 'ilp-protocol-stream/dist/src/packet'
import { Logger } from 'ilp-logger'
import { PaymentState } from '..'
import { Integer } from '../utils'
import BigNumber from 'bignumber.js'

/** Amounts and data to send a unique ILP Prepare over STREAM */
export interface StreamRequest {
  /** Sequence number of the STREAM packet (only up to u32) */
  sequence: number
  /** Amount to send in the ILP Prepare */
  sourceAmount: Integer
  /** Minimum destination amount to tell the recipient ("prepare amount") */
  minDestinationAmount: Integer
  /** Frames to load within the STREAM packet */
  requestFrames: Frame[]
  /** Logger namespaced to this connection and request sequence number */
  log: Logger
}

/** Amounts and data for an ILP Prepare and its Fulfill or Reject received over STREAM */
export interface StreamReply extends StreamRequest {
  /** Did we receive a valid STREAM response from the recipient? */
  isAuthentic: boolean
  /** Amount the recipient claimed to receive. Omitted if no authentic STREAM reply */
  destinationAmount?: Integer
  /** Parsed frames from the response STREAM packet. Omitted if no authentic STREAM reply */
  responseFrames?: Frame[]
}

/** Amounts and data for an ILP Prepare and Reject received over STREAM */
export interface StreamReject extends StreamReply {
  /** Parsed ILP Reject packet */
  reject: IlpReject
}

/** TODO */
export interface StreamController {
  /**
   * Determine the next state of the payment and compose the next packet.
   * - Any controller can choose to immediately end the entire STREAM payment,
   *   or choose to delay before sending more money.
   * - Note: this *cannot* assume the packet will be sent.
   * @param prepare Amounts and metadata for a proposed ILP Prepare to send over STREAM
   */
  nextState?(request: StreamRequestBuilder): PaymentState

  /**
   * Apply side effects before sending an ILP Prepare over STREAM.
   * - Synchronous with `nextState` to prevent race conditions
   * @param prepare Finalized amounts and data of the ILP Prepare
   */
  applyPrepare?(request: StreamRequest): void

  /** Apply side effects from an ILP Fulfill received over STREAM. */
  applyFulfill?(reply: StreamReply): void

  /** Apply side effects from an ILP Reject received over STREAM.*/
  applyReject?(reply: StreamReject): void
}

export interface ReplyController {
  applyFulfill(reply: StreamReply): void
  applyReject(reply: StreamReject): void
}

export const isNextStateController = (
  c: StreamController
): c is {
  nextState(builder: StreamRequestBuilder): PaymentState
} => 'nextState' in c

export const isPrepareController = (
  c: StreamController
): c is {
  applyPrepare(request: StreamRequest): void
} => 'applyPrepare' in c

export const isReplyController = (c: StreamController): c is ReplyController => 'applyFulfill' in c

export class StreamRequestBuilder {
  private sequence = 0
  private sourceAmount = new BigNumber(0) as Integer
  private minDestinationAmount = new BigNumber(0) as Integer
  private requestFrames: Frame[] = []
  public log: Logger

  constructor(log: Logger) {
    this.log = log
  }

  setSequence(sequence: number): this {
    this.sequence = sequence
    this.log = this.log.extend(`outgoing:${sequence.toString()}`)
    return this
  }

  setSourceAmount(sourceAmount: Integer): this {
    this.sourceAmount = sourceAmount
    return this
  }

  setMinDestinationAmount(minDestinationAmount: Integer): this {
    this.minDestinationAmount = minDestinationAmount
    return this
  }

  addFrames(...frames: Frame[]): this {
    this.requestFrames.push(...frames)
    return this
  }

  build(): StreamRequest {
    return {
      log: this.log,
      sequence: this.sequence,
      sourceAmount: this.sourceAmount,
      minDestinationAmount: this.minDestinationAmount,
      requestFrames: this.requestFrames
    }
  }
}
