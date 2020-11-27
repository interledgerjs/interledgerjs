import { Int } from './utils'
import { Frame } from 'ilp-protocol-stream/dist/src/packet'
import { Logger } from 'ilp-logger'
import { IlpReject, IlpAddress } from 'ilp-packet'

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
  frames: Frame[]
  /** Should the recipient be allowed to fulfill this request, or should it use a random condition? */
  isFulfillable: boolean
  /** Logger namespaced to this connection and request sequence number */
  log: Logger
}

export const DEFAULT_REQUEST: StreamRequest = {
  destinationAddress: 'private.example' as IlpAddress,
  expiresAt: new Date(),
  sequence: 0,
  sourceAmount: Int.ZERO,
  minDestinationAmount: Int.ZERO,
  frames: [],
  isFulfillable: false,
  log: new Logger('ilp-pay'),
}

/** Builder to construct the next ILP Prepare and STREAM request */
export class RequestBuilder {
  private request: StreamRequest

  // TODO Does this need to take a partial? Where is this used?
  constructor(request?: Partial<StreamRequest>) {
    this.request = {
      ...DEFAULT_REQUEST,
      ...request,
    }
  }

  /** Set the ILP address of the destination of the ILP Prepare */
  setDestinationAddress(address: IlpAddress): this {
    this.request.destinationAddress = address
    return this
  }

  /** Set the expiration time of the ILP Prepare */
  setExpiry(expiresAt: Date): this {
    this.request.expiresAt = expiresAt
    return this
  }

  /** Set the sequence number of STREAM packet, to correlate the reply */
  setSequence(sequence: number): this {
    this.request.sequence = sequence
    this.request.log = this.request.log.extend(sequence.toString())
    return this
  }

  /** Set the source amount of the ILP Prepare */
  setSourceAmount(sourceAmount: Int): this {
    this.request.sourceAmount = sourceAmount
    return this
  }

  /** Set the minimum destination amount for the receiver to fulfill the ILP Prepare */
  setMinDestinationAmount(minDestinationAmount: Int): this {
    this.request.minDestinationAmount = minDestinationAmount
    return this
  }

  /** Add frames to include for the STREAM receiver */
  addFrames(...frames: Frame[]): this {
    this.request.frames = [...this.request.frames, ...frames]
    return this
  }

  /** Enable the STREAM receiver to fulfill this ILP Prepare. By default, a random, unfulfillable condition is used. */
  enableFulfillment(): this {
    this.request.isFulfillable = true
    return this
  }

  build(): StreamRequest {
    return { ...this.request }
  }
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
