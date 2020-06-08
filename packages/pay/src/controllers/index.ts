/* eslint-disable @typescript-eslint/no-explicit-any */
import { IlpReject } from 'ilp-packet'
import { Frame, ConnectionCloseFrame, ErrorCode } from 'ilp-protocol-stream/dist/src/packet'
import { Logger } from 'ilp-logger'
import { PaymentError } from '..'
import { Int } from '../utils'

/** Amounts and data to send a unique ILP Prepare over STREAM */
export interface StreamRequest {
  /** Sequence number of the STREAM packet (u32) */
  sequence: number
  /** Amount to send in the ILP Prepare */
  sourceAmount: Int
  /** Minimum destination amount to tell the recipient ("prepare amount") */
  minDestinationAmount: Int
  /** Frames to load within the STREAM packet */
  requestFrames: Frame[]
  /** Should the recipient be allowed to fulfill this request, or should it use a random condition? */
  isFulfillable: boolean
  /** Logger namespaced to this connection and request sequence number */
  log: Logger
}

export interface StreamReply {
  /** Logger namespaced to this connection and request sequence number */
  readonly log: Logger
  /** Parsed frames from the STREAM response packet. Omitted if no authentic STREAM reply */
  readonly frames?: Frame[]
  /** Amount the recipient claimed to receive. Omitted if no authentic STREAM reply */
  readonly destinationAmount?: Int
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
  Ready = 'Ready',
  /** Temporarily pause sending money until any request finishes or some time elapses */
  Wait = 'Wait',
  /** Stop the payment */
  End = 'End',
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
  applyRequest(request: StreamRequest): (reply: StreamFulfill | StreamReject) => void
}

/** Set of all controllers keyed by their constructor */
export interface ControllerMap
  extends Map<new (...args: any[]) => StreamController, StreamController> {
  get<T extends StreamController>(key: new (...args: any[]) => T): T
}

export class StreamFulfill implements StreamReply {
  readonly log: Logger
  readonly frames?: Frame[]
  readonly destinationAmount?: Int

  constructor(log: Logger, frames?: Frame[], destinationAmount?: Int) {
    this.log = log
    this.frames = frames
    this.destinationAmount = destinationAmount
  }

  isAuthentic(): boolean {
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
  readonly destinationAmount?: Int
  readonly ilpReject: IlpReject

  constructor(log: Logger, ilpReject: IlpReject, frames?: Frame[], destinationAmount?: Int) {
    this.log = log
    this.ilpReject = ilpReject
    this.frames = frames
    this.destinationAmount = destinationAmount
  }

  isAuthentic(): boolean {
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
  private request: StreamRequest
  private sendRequest: (request: StreamRequest) => void

  constructor(log: Logger, sendRequest: (request: StreamRequest) => void) {
    this.request = {
      sequence: 0,
      sourceAmount: Int.ZERO,
      minDestinationAmount: Int.ZERO,
      requestFrames: [],
      isFulfillable: false,
      log,
    }
    this.sendRequest = sendRequest
  }

  get log(): Logger {
    return this.request.log
  }

  setSequence(sequence: number): this {
    this.request.sequence = sequence
    this.request.log = this.log.extend(sequence.toString())
    return this
  }

  setSourceAmount(sourceAmount: Int): this {
    this.request.sourceAmount = sourceAmount
    return this
  }

  setMinDestinationAmount(minDestinationAmount: Int): this {
    this.request.minDestinationAmount = minDestinationAmount
    return this
  }

  addFrames(...frames: Frame[]): this {
    this.request.requestFrames.push(...frames)
    return this
  }

  enableFulfillment(): this {
    this.request.isFulfillable = true
    return this
  }

  send(): StreamRequest {
    this.sendRequest(this.request)
    return this.request
  }

  sendConnectionClose(code = ErrorCode.NoError): StreamRequest {
    this.request.requestFrames.push(new ConnectionCloseFrame(code, ''))
    this.sendRequest(this.request)
    return this.request
  }
}
