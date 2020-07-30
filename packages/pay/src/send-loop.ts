import { PromiseResolver, Int } from './utils'
import { PaymentError, isPaymentError } from '.'
import { PendingRequestTracker } from './controllers/pending-requests'
import { ControllerMap, NextRequest } from './controllers'
import { Frame, ErrorCode, ConnectionCloseFrame } from 'ilp-protocol-stream/dist/src/packet'
import { IlpAddress } from 'ilp-packet'
import { Logger } from 'ilp-logger'
import { SendRequest } from './connection'

enum SendState {
  Running, // Running -> Pausing, Running -> Error
  Pausing, // Pausing -> Paused
  Paused, // Paused -> Running
  Error,
}

/** TODO Explain ... */
export interface SendLoop {
  /**
   * Start sending requests. Resolves when this run is paused or errors, after all pending requests complete.
   * If the send loop was already running, resolves when that run completes.
   */
  start(): Promise<PaymentError | void>

  /** Pause sending requests. Resolves after all pending requests complete, or if the last run already errored. */
  stop(): Promise<PaymentError | void>
}

export const createSendLoop = (
  sendRequest: SendRequest,
  controllers: ControllerMap,
  destinationAddress: IlpAddress,
  log: Logger
): SendLoop => {
  // Send loop is initially paused. `start` must be called to begin sending
  let state = SendState.Paused

  /** Completion of a single run of the send loop until it's paused or errors */
  let sendLoopRun = new PromiseResolver<PaymentError | void>()
  sendLoopRun.resolve() // (if `stop` is called initially, it should immediately resolve)

  /** Finish the send loop run after all pending requests complete, optionally with an error */
  const resolveSendLoop = (error?: PaymentError) =>
    Promise.all(controllers.get(PendingRequestTracker).getPendingRequests()).finally(() =>
      sendLoopRun.resolve(error)
    )

  /** Continually send requests until the send loop encounters an error or is paused */
  const trySending = (): void => {
    if (state === SendState.Pausing) {
      state = SendState.Paused
      resolveSendLoop()
      return
    }

    /** Is this request applied and queued to send? */
    let isSent = false

    // Builder to construct and send/cancel the STREAM request
    const request: NextRequest = {
      destinationAddress,
      expiresAt: new Date(),
      sequence: 0,
      sourceAmount: Int.ZERO,
      minDestinationAmount: Int.ZERO,
      requestFrames: [],
      isFulfillable: false,
      log,

      setDestinationAddress(address: IlpAddress) {
        this.destinationAddress = address
        return this
      },

      setExpiry(expiresAt: Date) {
        this.expiresAt = expiresAt
        return this
      },

      setSequence(sequence: number) {
        this.sequence = sequence
        this.log = this.log.extend(sequence.toString())
        return this
      },

      setSourceAmount(sourceAmount: Int) {
        this.sourceAmount = sourceAmount
        return this
      },

      setMinDestinationAmount(minDestinationAmount: Int) {
        this.minDestinationAmount = minDestinationAmount
        return this
      },

      addFrames(...frames: Frame[]) {
        this.requestFrames.push(...frames)
        return this
      },

      addConnectionClose(error = ErrorCode.NoError) {
        return this.addFrames(new ConnectionCloseFrame(error, ''))
      },

      enableFulfillment() {
        this.isFulfillable = true
        return this
      },

      send() {
        isSent = true
        const replyHandlers = [...controllers.values()].map((c) => c.applyRequest?.(this))
        sendRequest(this).then((reply) => {
          replyHandlers.forEach((f) => f && f(reply))
        })
      },
    }

    // Iterate through each controller to construct the next request,
    // send it, and determine the next state of the payment
    for (const c of controllers.values()) {
      const waitOrError = c.nextState?.(request, controllers)

      // If error, end the send loop immediately
      if (isPaymentError(waitOrError)) {
        state = SendState.Error
        resolveSendLoop(waitOrError)
        return
      }
      // If returned value is a Promise, cancel this request. Wait until it settles to try sending another request
      else if (typeof waitOrError === 'object') {
        waitOrError.finally(trySending)
        return
      }
      // If this request is complete, immediately try to send another
      else if (isSent) {
        return trySending()
      }
    }
  }

  return {
    start() {
      if (state === SendState.Paused) {
        state = SendState.Running
        // Create a new Promise corresponding to this run of the send loop
        sendLoopRun = new PromiseResolver<PaymentError | void>()
        trySending()
      }

      return sendLoopRun.promise
    },

    stop() {
      if (state === SendState.Running) {
        state = SendState.Pausing
      }

      return sendLoopRun.promise
    },
  }
}
