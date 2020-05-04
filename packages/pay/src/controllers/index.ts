/* eslint-disable @typescript-eslint/no-explicit-any */
import { IlpReject } from 'ilp-packet'
import { Frame } from 'ilp-protocol-stream/dist/src/packet'
import { Logger } from 'ilp-logger'
import { PaymentError } from '..'
import { Integer } from '../utils'
import BigNumber from 'bignumber.js'

/** Amounts and data to send a unique ILP Prepare over STREAM */
export interface StreamRequest {
  /** Sequence number of the STREAM packet (u32) */
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
  /** Amount the recipient claimed to receive. Omitted if no authentic STREAM reply */
  destinationAmount?: Integer
  /** Parsed frames from the response STREAM packet. Omitted if no authentic STREAM reply */
  responseFrames?: Frame[]
}

/** Amounts and data for an ILP Prepare and its ILP Reject received over STREAM */
export interface StreamReject extends StreamReply {
  /** Parsed ILP Reject received over STREAM */
  reject: IlpReject
}

/** Next state as signaled by each controller */
export enum SendState {
  /** Ready to send money and apply the next ILP Prepare */
  Ready = 'ready',
  /** Temporarily pause sending money until any request finishes or some time elapses */
  Wait = 'wait',
  /** Stop the payment */
  End = 'end',
}

/**
 * Controllers orchestrate when to send packets, their amounts, and data.
 * Each controller implements its own business logic to handle a different piece
 * of the payment or STREAM protocol
 */
export interface StreamController {
  /**
   * Signal if sending should continue and iteratively compose the next packet.
   * - Any controller can choose to immediately end the entire STREAM payment
   *   with an error, or choose to wait before sending the next packet.
   * - Note: the packet may not be sent if other controllers decline, so don't apply side effects.
   * @param builder Builder to construct the next ILP Prepare and STREAM request
   */
  nextState?(builder: StreamRequestBuilder): SendState | PaymentError
  /**
   * Apply side effects before sending an ILP Prepare over STREAM.
   * Called synchronously with `nextState` and `applyPrepare` for all controllers
   * @param request Finalized amounts and data of the ILP Prepare
   */
  applyPrepare?(request: StreamRequest): void
  /**
   * Apply side effects from an ILP Fulfill or ILP Reject received over STREAM
   * @param reply Parsed amounts and data of the ILP Fulfill and STREAM reply
   */
  applyFulfill?(reply: StreamReply): void
  /**
   * Apply side effects from an ILP Reject received over STREAM
   * @param reply Parsed amounts and data of the ILP Reject and STREAM reply
   */
  applyReject?(reply: StreamReject): void
}

/** Set of all controllers keyed by their constructor */
export interface ControllerMap
  extends Map<new (...args: any[]) => StreamController, StreamController> {
  get<T extends StreamController>(key: new (...args: any[]) => T): T
}

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
    this.log = this.log.extend(sequence.toString())
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
      requestFrames: this.requestFrames,
    }
  }
}

/** Is the given STREAM reply an ILP Fulfill packet? */
export const isFulfill = (reply: StreamReply): boolean => !('reject' in reply)

/**
 * Did the recipient authenticate that they received the STREAM request packet?
 * If they responded with a Fulfill or valid STREAM reply, they necessarily decoded the request
 */
export const isAuthentic = (reply: StreamReply): boolean =>
  !!reply.responseFrames || isFulfill(reply)

/**
 * Should the recipient be allowed to fulfill this request, or should it use a random condition?
 * If we couldn't compute a minimum destination amount (e.g. don't know asset details yet),
 * packet MUST be unfulfillable so no money is at risk
 */
export const isFulfillable = (request: StreamRequest): boolean =>
  request.sourceAmount.isGreaterThan(0) && request.minDestinationAmount.isGreaterThan(0)
