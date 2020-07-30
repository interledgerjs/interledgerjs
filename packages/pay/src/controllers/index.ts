/* eslint-disable @typescript-eslint/no-explicit-any */
import { IlpReject, IlpAddress } from 'ilp-packet'
import { Frame, ErrorCode } from 'ilp-protocol-stream/dist/src/packet'
import { Logger } from 'ilp-logger'
import { PaymentError } from '..'
import { Int } from '../utils'

/** Amounts and data to send a unique ILP Prepare over STREAM */
export interface StreamRequest {
  /** ILP address of the recipient account */
  destinationAddress: IlpAddress
  /** Expiration timestamp when the ILP Prepare is void */
  expiresAt: Date
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

/** Builder to construct the next ILP Prepare and STREAM request */
export interface NextRequest extends StreamRequest {
  /** Set the ILP address of the destination of the ILP Prepare */
  setDestinationAddress(address: IlpAddress): this
  /** Set the expiration time of the ILP Prepare */
  setExpiry(expiry: Date): this
  /** Set the sequence number of STREAM packet, to correlate the reply */
  setSequence(sequence: number): this
  /** Set the source amount of the ILP Prepare */
  setSourceAmount(amount: Int): this
  /** Set the minimum destination amount for the receiver to fulfill the ILP Prepare */
  setMinDestinationAmount(amount: Int): this
  /** Add frames to include for the STREAM receiver */
  addFrames(...frames: Frame[]): this
  /** Add a `ConnectionClose` frame to indicate to the receiver that no more packets will be sent. */
  addConnectionClose(error?: ErrorCode): this
  /** Enable the STREAM receiver to fulfill this ILP Prepare. By default, a random, unfulfillable condition is used. */
  enableFulfillment(): this
  /** Finalize and apply this request (synchronously) and queue it to be sent asynchronously */
  send(): void
}

/**
 * Controllers orchestrate when to send packets, their amounts, and data.
 * Each controller implements its own business logic to handle a different part of the payment or STREAM protocol.
 */
export interface StreamController {
  /**
   * Each controller iteratively constructs the next request and can optionally send it
   * using `request.send()`. The send loop advances through each controller until
   * the request is sent or cancelled.
   *
   * To cancel this request, a controller can return an error to end the entire payment,
   * or return a Promise which is awaited before another request is attempted.
   *
   * Note: other controllers may change the request or cancel it, so no side effects
   * should be performed (unless they're within the controller which calls `send` on the request).
   *
   * @param request Builder to construct the next ILP Prepare and STREAM request
   * @param controllers Set of all other controllers
   */
  nextState?(request: NextRequest, controllers: ControllerMap): Promise<any> | PaymentError | void

  /**
   * Apply side effects before sending an ILP Prepare over STREAM. Return a callback function to apply
   * side effects from the corresponding ILP Fulfill or ILP Reject and STREAM reply.
   *
   * `applyRequest` is called for all controllers synchronously after a request is sent
   * within `nextState`.
   *
   * @param request Finalized amounts and data of the ILP Prepare and STREAM request
   */
  applyRequest?(request: StreamRequest): ((reply: StreamFulfill | StreamReject) => void) | void
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
