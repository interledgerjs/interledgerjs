/* eslint-disable @typescript-eslint/no-explicit-any */
import { PaymentError, isPaymentError } from '..'
import { PromiseResolver } from '../utils'
import { StreamRequest, StreamReply, DEFAULT_REQUEST } from '../request'
import { StreamConnection } from '../connection'

// TODO Update these comments !!!

/**
 * Controllers orchestrate when to send packets, their amounts, and data.
 * Each controller implements its own business logic to handle a different part of the payment or STREAM protocol.
 */
export interface StreamController {
  /**
   * TODO fix
   * Each controller iteratively constructs the next request and can optionally send it
   * using `request.send()`. The send loop advances through each controller until
   * the request is sent or cancelled.
   *
   * To cancel this request, a controller can return an error to end the entire payment,
   * or return a Promise to delay trying another request until it resolves.
   *
   * Note: other controllers may change the request or cancel it, so no side effects
   * should be performed here.
   *
   * @param request Builder to construct the next ILP Prepare and STREAM request
   */
  nextState?(request: StreamRequest): StreamRequest | PromiseLike<any> | PaymentError

  /**
   * Apply side effects before sending an ILP Prepare over STREAM. Return a callback function to apply
   * side effects from the corresponding ILP Fulfill or ILP Reject and STREAM reply.
   *
   * `applyRequest` is called for all controllers synchronously when the sending controller queues the
   * request to be sent.
   *
   * Any of the reply handlers can also return an error to end the payment.
   *
   * @param request Finalized amounts and data of the ILP Prepare and STREAM request
   */
  applyRequest?(request: StreamRequest): ((reply: StreamReply) => PaymentError | void) | undefined
}

// TODO Does this need to await pending requests first somewhere before completing?

type Constructor<T> = new (...args: any[]) => T

/** Set of all controllers keyed by their constructor */
interface ControllerMap extends Map<Constructor<StreamController>, StreamController> {
  get<T extends StreamController>(key: Constructor<T>): T
}

export class ControllerSet {
  private readonly map = new Map() as ControllerMap

  add(controller: StreamController): this {
    this.map.set(Object.getPrototypeOf(controller).constructor, controller)
    return this
  }

  get<T extends StreamController>(Constructor: Constructor<T>): T {
    const existingController = this.map.get(Constructor)
    if (existingController) {
      return existingController // TODO
    }

    const controller = new Constructor()
    this.map.set(Constructor, controller)
    return controller
  }
}

/**
 * TODO What if this handled in-flight requests too? So no floating promise,
 *      and everything was treated as psuedo-synchronous!?
 */

export abstract class SendLoop<T> {
  /** TODO */
  // private readonly replyError = new PromiseResolver<T | PaymentError>()

  /** TODO. This is used to schedule the side effects so they aren't immediately applied */
  private readonly pendingRequestEffects = new Set<Promise<() => PaymentError | void>>()

  constructor(
    private readonly connection: StreamConnection,
    protected readonly controllers: ControllerSet
  ) {}

  /** TODO explain */
  protected send(
    request: StreamRequest
    // handler?: (reply: StreamReply) => PaymentError | void // TODO Keep this? that way all side effects are synchronous
  ): void {
    // Synchronously apply the request
    const replyHandlers = this.order.map((c) => this.controllers.get(c).applyRequest?.(request))
    // replyHandlers.push(handler)

    // Asynchronously send the request
    const promise = this.connection.sendRequest(request).then((reply) => () => {
      // Apply all reply handlers, then end loop if a payment error was encountered
      // (must be applied through all handlers, but only the first error is returned)
      const error = replyHandlers.map((applyReply) => applyReply?.(reply)).find(isPaymentError)
      this.pendingRequestEffects.delete(promise)
      return error
    })
    this.pendingRequestEffects.add(promise)
  }

  // TODO remove this?
  // resolve(value: T): void {
  //   this.replyError.resolve(value)
  // }

  // TODO Add back the `resolve` method so e.g. the payment controller can call it imperatively?
  //      Or is there a better way that could be implemented? Promise.race in `trySending`?
  //      Or should I move the "payment is finished" checks back to the beginning of `trySending`?
  //      (e.g. is it good for the reply handler to get called multiple times before it ends...?)
  //      But won't it be called multiple times anyways...?

  // TODO Should this also wait for all pending requests to complete, or not?
  //      Do I need a separately entry point function to do this?

  async queue(task: Promise<() => PaymentError | void>): Promise<T | PaymentError> {
    // Wait the delay or for any pending requests to complete
    // Apply side effects from the reply, which may end the payment
    const apply = await Promise.race([...this.pendingRequestEffects, task])
    const result = apply() // TODO Really, this should be the task function, right?
    if (isPaymentError(result)) {
      return Promise.all(this.pendingRequestEffects).then(() => result)
    }

    // TODO This won't work, since initially no requests will be in-flight...

    // If no requests are in flight, check if the send loop can be resolved
    if (this.pendingRequestEffects.size === 0) {
      const result = this.finalize()
      if (result) {
        // TODO No pending requests to await
        return result
      }
    }

    // TODO What to do next? Indefinite queue?
  }

  /**
   * TODO Note that this DOESN'T run the send loop recursively because it calls try sending ---
   * "mutual recursion"
   *
   * Schedule another request to be attempted after the given promise resolves.
   * If the send loop ends before then (such as if a reply is received), resolve with that value.
   *
   * Return a Promise that resolves the send loop.
   */
  async run(delay: Promise<any>): Promise<T | PaymentError> {
    // TODO Wait for delay OR any pending request to complete?

    // Wait the delay or for any pending requests to complete
    // Apply side effects from the reply, which may end the payment
    const applyReply = await Promise.race([
      ...this.pendingRequestEffects,
      delay.then(() => undefined), // TODO The initial delay would have to be immediate
    ])
    const result = applyReply?.()
    if (isPaymentError(result)) {
      return Promise.all(this.pendingRequestEffects).then(() => result)
    }

    // TODO This won't work, since initially no requests will be in-flight...

    // If no requests are in flight, check if the send loop can be resolved
    if (this.pendingRequestEffects.size === 0) {
      const result = this.isDone()
      if (result) {
        return result
      }
    }

    // TODO What about the resolved state...?

    // TODO What if this called a method to imperatively check if the payment is complete!?
    //      Also, that should ensure it's only called once,
    //      and only called it no requests are currently in-flight.

    // const error = await Promise.race([this.replyError.promise, delay])
    // if (isPaymentError(error)) {
    //   return error
    // }

    // Iteratively let each controller build the request, end with an error, or reschedule the attempt
    const state = this.order
      .map((c) => this.controllers.get(c))
      .reduce<StreamRequest | PromiseLike<void> | PaymentError>(
        (res, controller) =>
          isPaymentError(res) || isPromiseLike(res) ? res : controller.nextState?.(res) ?? res,
        {
          ...DEFAULT_REQUEST,
          log: this.connection.log,
        }
      )

    // If an error is encountered, immediately end the send loop
    return isPaymentError(state)
      ? state // TODO Wait for pending requests to complete?
      : // If a Promise, schedule next attempt
      isPromiseLike(state)
      ? this.run(state)
      : // Otherwise, try to send or apply this request
        this.trySending(state)
  }

  /** Order of controllers to build each request, signal next state, and apply side effects */
  protected abstract readonly order: Constructor<StreamController>[]

  /** TODO explain */
  protected abstract trySending(request: StreamRequest): Promise<T | PaymentError>

  /** TODO only called if no requests are in-flight ... */
  protected abstract finalize(): T | PaymentError
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const isPromiseLike = (o: any): o is Promise<any> =>
  typeof o === 'object' && 'then' in o && typeof o.then === 'function'
