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
   * Controllers iteratively construct the next request before it is sent using the given builder.
   *
   * Each controller in order signals the status of the request attempt:
   * - `RequestState.Ready`    -- ready to apply and send this request,
   * - `RequestState.Error`    -- to immediately end the send loop with an error,
   * - `RequestState.Schedule` -- to cancel this request attempt and try again at a later time,
   * - `RequestState.Yield`    -- to cancel this request attempt and not directly schedule another.
   *
   * The request is only sent if all controllers signal `Ready` and the sender explicitly
   * commits and sends the request.
   *
   * Note: since subsequent controllers may change the request or cancel it,
   * no side effects should be performed here.
   *
   * @param request Proposed ILP Prepare and STREAM request
   */
  buildRequest?(request: RequestBuilder): RequestState
  // TODO Change this to `RequestBuilder` | `RequestState`, so it's kinda reduced through each?

  /**
   * Apply side effects before sending an ILP Prepare over STREAM. Return a callback function to apply
   * side effects from the corresponding ILP Fulfill or ILP Reject and STREAM reply.
   *
   * `applyRequest` is called for all controllers synchronously when the sending controller queues the
   * request to be sent.
   *
   * Any of the reply handlers may also return an error to immediately end the send loop.
   *
   * @param request Finalized amounts and data of the ILP Prepare and STREAM request
   */
  applyRequest?(request: StreamRequest): ((reply: StreamReply) => PaymentError | void) | undefined
}

/**
 * Resolves send loops, tracking when the successful completion criteria is met.
 *
 * While other controllers hold "veto" power over individual request attempts,
 * only the sender can explicitly send each request.
 */
export interface StreamSender<T> {
  readonly order: Constructor<StreamController>[] // TODO
  nextState(context: SenderContext<T>): SendState<T>
}

/** TODO Explain */
export interface SenderContext<T> {
  /** Proposed ILP Prepare and STREAM request */
  request: RequestBuilder

  /**
   * Send and apply the given request, which synchronously calls `applyRequest` on all controllers.
   *
   * Also, provide a callback to apply side effects from the reply, which is called synchronously after
   * the reply handlers for all other controllers. This handler may also return an error, schedule a
   * request attempt, or successfully resolve the send loop.
   */
  send: (applyReply: (reply: StreamReply) => SendState<T>) => void

  /** Lookup or create an instance of another controller. Each send loop only instantiates a single controller per constructor */
  lookup: <T extends StreamController>(key: Constructor<T>) => T
}

/** TODO */
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
}

// TODO Remove `Ready`, then simplify SendState to `Done | RequestState`?

/** States each controller may signal when building the next request */
export type RequestState =
  | { type: SendStateType.Ready }
  | { type: SendStateType.Error; error: PaymentError }
  | { type: SendStateType.Schedule; delay: Promise<any> }
  | { type: SendStateType.Yield }

/** States the sender may signal to determine the next state of the send loop */
export type SendState<T> =
  | { type: SendStateType.Done; value: T }
  | { type: SendStateType.Error; error: PaymentError }
  | { type: SendStateType.Schedule; delay: Promise<any> }
  | { type: SendStateType.Yield }

/** Immediately end the loop and payment with an error. */
const Error = (error: PaymentError): { type: SendStateType.Error; error: PaymentError } => ({
  type: SendStateType.Error,
  error,
})

/**
 * Schedule another request attempt after the delay, or as soon as possible if
 * no delay was provided.
 */
const Schedule = (delay?: Promise<any>): { type: SendStateType.Schedule; delay: Promise<any> } => ({
  type: SendStateType.Schedule,
  delay: delay ?? Promise.resolve(),
})

/**
 * Cancel this request, and don't schedule another attempt. Sending will pause until
 * an in-flight request completes and its reply handler schedules another attempt.
 */
const Yield = (): { type: SendStateType.Yield } => ({ type: SendStateType.Yield })

/** Immediately resolve the send loop as successful. */
const Done = <T>(value: T): { type: SendStateType.Done; value: T } => ({
  type: SendStateType.Done,
  value,
})

/** Ready for this request to be immediately applied and sent. */
const Ready = (): { type: SendStateType.Ready } => ({
  type: SendStateType.Ready,
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
}
