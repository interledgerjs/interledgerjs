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

export interface StreamReply {
  /** Logger namespaced to this connection and request sequence number */
  readonly log: Logger
  /** Parsed frames from the STREAM response packet. Omitted if no authentic STREAM reply */
  readonly frames?: Frame[]
  /** Amount the recipient claimed to receive. Omitted if no authentic STREAM reply */
  readonly destinationAmount?: Integer
  /**
   * Did the recipient authenticate that they received the STREAM request packet?
   * If they responded with a Fulfill or valid STREAM reply, they necessarily decoded the request
   */
  isAuthentic(): boolean
  /** Is this an ILP Reject packet? */
  isReject(): this is StreamReject
  /** Is this an ILP Fulfill packet? */
  isFulfill(): this is StreamFulfill
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
   * Return an optional callback function to apply side effects from the
   * corresponding reply (ILP Fulfill or ILP Reject) received over STREAM.
   *
   * `applyRequest` is called synchronously after `nextState` for all controllers.
   *
   * @param request Finalized amounts and data of the ILP Prepare
   */
  applyRequest(request: StreamRequest): (reply: StreamReply) => void
}

/** Set of all controllers keyed by their constructor */
export interface ControllerMap
  extends Map<new (...args: any[]) => StreamController, StreamController> {
  get<T extends StreamController>(key: new (...args: any[]) => T): T
}

export class StreamFulfill implements StreamReply {
  readonly log: Logger
  readonly frames?: Frame[]
  readonly destinationAmount?: Integer

  constructor(log: Logger, frames?: Frame[], destinationAmount?: Integer) {
    this.log = log
    this.frames = frames
    this.destinationAmount = destinationAmount
  }

  isAuthentic() {
    return true
  }

  isReject(): this is StreamReject {
    return false
  }

  isFulfill(): this is StreamFulfill {
    return true
  }
}

export class StreamReject implements StreamReply {
  readonly log: Logger
  readonly frames?: Frame[]
  readonly destinationAmount?: Integer
  readonly ilpReject: IlpReject

  constructor(log: Logger, ilpReject: IlpReject, frames?: Frame[], destinationAmount?: Integer) {
    this.log = log
    this.ilpReject = ilpReject
    this.frames = frames
    this.destinationAmount = destinationAmount
  }

  isAuthentic() {
    return !!this.frames && !!this.destinationAmount
  }

  isReject(): this is StreamReject {
    return true
  }

  isFulfill(): this is StreamFulfill {
    return false
  }
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

// TODO Replace with method on StreamRequest?

/**
 * Should the recipient be allowed to fulfill this request, or should it use a random condition?
 * If we couldn't compute a minimum destination amount (e.g. don't know asset details yet),
 * packet MUST be unfulfillable so no money is at risk
 */
export const isFulfillable = (request: StreamRequest): boolean =>
  request.sourceAmount.isGreaterThan(0) && request.minDestinationAmount.isGreaterThan(0)
