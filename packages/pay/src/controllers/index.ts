/* eslint-disable @typescript-eslint/no-explicit-any */
import { PaymentError } from '..'
import { StreamRequest, StreamReply, RequestBuilder } from '../request'
import { Constructor } from '../utils'

/**
 * Controllers orchestrate when packets are sent, their amounts, and data.
 * Each controller implements its own business logic to handle a different part of the payment or STREAM protocol.
 */
export interface StreamController {
  /**
   * Controllers iteratively construct the next request and signal the status of the request attempt:
   * - `RequestState.Ready`    -- ready to apply and send this request,
   * - `RequestState.Error`    -- to immediately end the send loop with an error,
   * - `RequestState.Schedule` -- to cancel this request attempt and try again at a later time,
   * - `RequestState.Yield`    -- to cancel this request attempt and not directly schedule another.
   *
   * If any controller does not signal `Ready`, that request attempt will be cancelled.
   *
   * Note: since subsequent controllers may change the request or cancel it,
   * no side effects should be performed here.
   *
   * @param request Proposed ILP Prepare and STREAM request
   */
  buildRequest?(request: RequestBuilder): RequestState

  /**
   * Apply side effects before sending an ILP Prepare over STREAM. Return a callback function to apply
   * side effects from the corresponding ILP Fulfill or ILP Reject and STREAM reply.
   *
   * `applyRequest` is called for all controllers synchronously when the sending controller queues the
   * request to be sent.
   *
   * The returned reply handler may also return an error to immediately end the send loop.
   *
   * @param request Finalized amounts and data of the ILP Prepare and STREAM request
   */
  applyRequest?(request: StreamRequest): ((reply: StreamReply) => PaymentError | void) | undefined
}

/**
 * Orchestrates a send loop, or series of requests.
 *
 * Sends and commits each request, and tracks completion criteria to
 * resolve the send loop to its own value.
 *
 * While other controllers hold "veto" power over individual request attempts,
 * only the sender explicitly commits to sending each request.
 */
export interface StreamSender<T> {
  /** Order of STREAM controllers to iteratively build a request or cancel the attempt */
  readonly order: Constructor<StreamController>[]

  /**
   * Track completion criteria to finalize and send this request the attempt,
   * end the send loop, or re-schedule.
   *
   * Return state of the send loop:
   * - `SendState.Send`     -- to send the request, applying side effects through all controllers in order,
   * - `SendState.Done`     -- to resolve the send loop as successful,
   * - `SendState.Error`    -- to end send loop with an error,
   * - `SendState.Schedule` -- to cancel this request attempt and try again at a later time,
   * - `SendState.Yield`    -- to cancel this request attempt and not directly schedule another.
   *
   * @param request Proposed ILP Prepare and STREAM request
   * @param lookup Lookup or create an instance of another controller. Each connection instantiates a single controller per constructor
   */
  nextState(request: RequestBuilder, lookup: GetController): SendState<T>
}

/** Lookup a controller instance by its constructor */
export type GetController = <T extends StreamController>(key: Constructor<T>) => T

export enum SendStateType {
  /** Ready to send and apply a request */
  Ready,
  /** Finish send loop successfully */
  Done,
  /** Finish send loop with an error */
  Error,
  /** Schedule another request attempt later. If applicable, cancels current attempt */
  Schedule,
  /** Do not schedule another attempt. If applicable, cancels current attempt */
  Yield,
  /** Commit to send and apply the request */
  Send,
}

/** States each controller may signal when building the next request */
export type RequestState = Error | Schedule | Yield | Ready

/** States the sender may signal to determine the next state of the send loop */
export type SendState<T> = Error | Schedule | Yield | Commit<T> | Done<T>

type Error = {
  type: SendStateType.Error
  error: PaymentError
}

/** Immediately end the loop and payment with an error. */
const Error = (error: PaymentError): Error => ({
  type: SendStateType.Error,
  error,
})

type Schedule = {
  type: SendStateType.Schedule
  delay: Promise<any>
}

/**
 * Schedule another request attempt after the delay, or as soon as possible if
 * no delay was provided.
 */
const Schedule = (delay?: Promise<any>): Schedule => ({
  type: SendStateType.Schedule,
  delay: delay ?? Promise.resolve(),
})

type Yield = {
  type: SendStateType.Yield
}

/** Don't immediately schedule another request attempt. If applicable, cancel the current attempt. */
const Yield = (): Yield => ({ type: SendStateType.Yield })

type Done<T> = {
  type: SendStateType.Done
  value: T
}

/** Immediately resolve the send loop as successful. */
const Done = <T>(value: T): Done<T> => ({
  type: SendStateType.Done,
  value,
})

type Ready = {
  type: SendStateType.Ready
}

/** Ready for this request to be immediately applied and sent. */
const Ready = (): Ready => ({
  type: SendStateType.Ready,
})

type Commit<T> = {
  type: SendStateType.Send
  applyReply: (reply: StreamReply) => Done<T> | Schedule | Yield | Error
}

/**
 * Apply and send the request.
 *
 * @param applyReply Callback to apply side effects from the reply, called synchronously after all other
 * controllers' reply handlers. The handler may resolve the the send loop, return an error, or re-schedule an attempt.
 */
const Send = <T>(
  applyReply: (reply: StreamReply) => Done<T> | Schedule | Yield | Error
): Commit<T> => ({
  type: SendStateType.Send,
  applyReply,
})

export const RequestState = {
  Ready,
  Error,
  Schedule,
  Yield,
}

export const SendState = {
  Done,
  Error,
  Schedule,
  Yield,
  Send,
}
