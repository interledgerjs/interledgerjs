/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  StreamSender,
  StreamController,
  SendState,
  SendStateType,
  RequestState,
} from './controllers'
import { RequestBuilder, generateKeys, StreamRequest, StreamReply } from './request'
import { isPaymentError, PaymentError } from '.'
import { Constructor } from './utils'
import { PaymentDestination } from './open-payments'
import { hash } from 'ilp-protocol-stream/dist/src/crypto'
import createLogger, { Logger } from 'ilp-logger'
import { Plugin } from './request'

/** Coordinate all business rules to schedule and send ILP/STREAM requests for one unique destination */
export class StreamConnection {
  /** Controllers each manage a different aspect of the connection */
  private readonly controllers = new Map<Constructor<StreamController>, StreamController>()

  constructor(
    /** Unique details to establish the connection to the recipient */
    private readonly destinationDetails: PaymentDestination,

    /** Send an ILP Prepare over STREAM, then parse and authenticate the reply */
    private readonly sendRequest: (request: StreamRequest) => Promise<StreamReply>,

    /** Logger namespaced to this connection */
    public readonly log: Logger
  ) {}

  static async create(
    plugin: Plugin,
    destinationDetails: PaymentDestination
  ): Promise<StreamConnection> {
    const { destinationAddress, sharedSecret } = destinationDetails

    const connectionId = await hash(Buffer.from(destinationAddress))
    const log = createLogger(`ilp-pay:${connectionId.toString('hex').slice(0, 6)}`)

    const sendRequest = await generateKeys(plugin, sharedSecret)
    return new StreamConnection(destinationDetails, sendRequest, log)
  }

  /**
   * Send a series of requests, initiated by the given STREAM sender,
   * until it completes its send loop or a payment error is encountered.
   *
   * Only one send loop can run at a time. A STREAM connection
   * may run successive send loops for different functions or phases.
   */
  async runSendLoop<T>(sender: StreamSender<T>): Promise<T | PaymentError> {
    // Queue for all side effects, which return the next state of the payment
    const requestScheduler = new Scheduler<() => SendState<T>>() // Side effects from requests
    const replyScheduler = new Scheduler<() => SendState<T>>() // Side effects from replies

    const trySending = (): SendState<T> => {
      const request = new RequestBuilder({ log: this.log })
      const requestState = sender.order
        .map((c) => this.getController(c))
        .reduce<RequestState>(
          (state, controller) =>
            state.type === SendStateType.Ready
              ? controller.buildRequest?.(request) ?? state
              : state,
          RequestState.Ready()
        )
      if (requestState.type !== SendStateType.Ready) {
        return requestState // Cancel this attempt
      }

      // If committing and sending this request, continue
      const state = sender.nextState(request, this.getController.bind(this))
      if (state.type !== SendStateType.Send) {
        return state // Cancel this attempt
      }

      // Synchronously apply the request
      const replyHandlers = sender.order.map((c) => this.getController(c).applyRequest?.(request))

      // Asynchronously send the request and queue the reply side effects as another task
      const task = this.sendRequest(request).then((reply) => () => {
        // Execute *all handlers*, then return the first error or next state
        // (For example, even if a payment error occurs in a controller, it shouldn't return
        //  immediately since that packet still needs to be correctly accounted for)
        const error = replyHandlers.map((apply) => apply?.(reply)).find(isPaymentError)
        const newState = state.applyReply(reply)
        return error ? SendState.Error(error) : newState
      })

      replyScheduler.queue(task)

      return SendState.Schedule() // Schedule another attempt immediately
    }

    // Queue initial attempt to send a request
    requestScheduler.queue(Promise.resolve(trySending))

    for (;;) {
      const applyEffects = await Promise.race([replyScheduler.next(), requestScheduler.next()])
      const state = applyEffects()

      switch (state.type) {
        case SendStateType.Done:
          await replyScheduler.complete() // Wait to process oustanding requests
          return state.value

        case SendStateType.Error:
          await replyScheduler.complete() // Wait to process oustanding requests
          return state.error

        case SendStateType.Schedule:
          requestScheduler.queue(state.delay.then(() => trySending))
          break
      }
    }
  }

  private getController<T extends StreamController>(Constructor: Constructor<T>): T {
    const existingController = this.controllers.get(Constructor)
    if (existingController) {
      return existingController as T
    }

    const controller = new Constructor(this.destinationDetails)
    this.controllers.set(Constructor, controller)
    return controller
  }
}

/**
 * Task scheduler: a supercharged `Promise.race`.
 *
 * Queue "tasks", which are Promises resolving with a function. The scheduler aggregates
 * all pending tasks, where `next()` resolves to the task which resolves first. Critically,
 * this also *includes any tasks also queued while awaiting the aggregate Promise*.
 * Then, executing the resolved function removes the task, so the remaining
 * pending tasks can also be aggregated and awaited.
 */
class Scheduler<T extends (...args: any[]) => any> {
  /** Set of tasks yet to be executed */
  private pendingTasks = new Set<Promise<T>>()

  /**
   * Resolves to the task of the first event to resolve.
   * Replaced with a new tick each time a task is executed
   */
  private nextTick = new PromiseResolver<T>()

  /**
   * Resolve to the pending task which resolves first, including existing tasks
   * and any added after this is called.
   */
  next(): Promise<T> {
    this.nextTick = new PromiseResolver<T>()
    this.pendingTasks.forEach((task) => {
      this.resolveTick(task)
    })

    return this.nextTick.promise
  }

  /**
   * Execute all pending tasks immediately when they resolve,
   * then resolve after all have resolved.
   */
  async complete(): Promise<any> {
    return Promise.all([...this.pendingTasks].map((promise) => promise.then((run) => run())))
  }

  /** Schedule a task, which is Promise resolving to a function to execute */
  queue(task: Promise<T>): void {
    this.pendingTasks.add(task)
    this.resolveTick(task)
  }

  /**
   * Resolve the current tick when the given task resolves. Wrap
   * the task's function to remove it as pending if it's executed.
   */
  private async resolveTick(task: Promise<T>): Promise<void> {
    const run = await task
    this.nextTick.resolve(
      <T>((...args: Parameters<T>): ReturnType<T> => {
        this.pendingTasks.delete(task)
        return run(...args)
      })
    )
  }
}

/** Promise that can be resolved or rejected outside its executor callback. */
class PromiseResolver<T> {
  resolve!: (value: T) => void
  reject!: () => void
  readonly promise = new Promise<T>((resolve, reject) => {
    this.resolve = resolve
    this.reject = reject
  })
}
