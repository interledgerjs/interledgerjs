/* eslint-disable @typescript-eslint/no-explicit-any */
import { StreamConnection } from './connection'
import {
  StreamSender,
  StreamController,
  SendState,
  SendStateType,
  RequestState,
} from './controllers'
import { RequestBuilder } from './request'
import { isPaymentError, PaymentError } from '.'
import { Constructor } from './utils'

/** TODO */
export class SendLoop {
  /** Single set of all controllers */
  private readonly controllers = new Map<Constructor<StreamController>, StreamController>()

  constructor(private readonly connection: StreamConnection) {}

  async run<T>(sender: StreamSender<T>): Promise<T | PaymentError> {
    // Queue for all side effects, which return the next state of the payment
    const requestScheduler = new Scheduler<() => SendState<T>>() // Side effects from requests
    const replyScheduler = new Scheduler<() => SendState<T>>() // Side effects from replies

    const trySending = (): SendState<T> => {
      const request = new RequestBuilder({ log: this.connection.log })
      const state = sender.order
        .map((c) => this.lookup(c))
        .reduce<RequestState>(
          (state, controller) =>
            state.type === SendStateType.Ready
              ? controller.buildRequest?.(request) ?? state
              : state,
          RequestState.Ready()
        )
      if (state.type !== SendStateType.Ready) {
        return state
      }

      return sender.nextState({
        request,
        lookup: this.lookup.bind(this),
        send: (handler) => {
          // Synchronously apply the request
          const replyHandlers = sender.order.map((c) => this.lookup(c).applyRequest?.(request))

          // Asynchronously send the request and queue the reply side effects as a task
          const task = this.connection.sendRequest(request).then((reply) => () => {
            // Execute *all handlers*, then return the first error or state
            // (For example, even if a payment error occurs in a controller, it shouldn't return
            //  immediately since that packet still needs to be correctly accounted for)
            const error = replyHandlers.map((apply) => apply?.(reply)).find(isPaymentError)
            const state = handler(reply)
            return error ? SendState.Error(error) : state
          })
          replyScheduler.queue(task)
        },
      })
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

  private lookup<T extends StreamController>(Constructor: Constructor<T>): T {
    const existingController = this.controllers.get(Constructor)
    if (existingController) {
      return existingController as T
    }

    const controller = new Constructor(this.connection.destinationDetails)
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
