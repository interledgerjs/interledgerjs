import createLogger from 'ilp-logger'
import {
  deserializeIlpPrepare,
  IlpReply,
  isFulfill,
  isReject,
  serializeIlpPrepare,
  IlpPrepare,
  deserializeIlpFulfill,
  deserializeIlpReject,
  Type,
} from 'ilp-packet'
import {
  generateFulfillment,
  generateFulfillmentKey,
  generatePskEncryptionKey,
  generateRandomCondition,
  hash,
} from 'ilp-protocol-stream/dist/src/crypto'
import { Frame, IlpPacketType, Packet } from 'ilp-protocol-stream/dist/src/packet'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { PaymentError, isPaymentError } from '.'
import {
  SendState,
  ControllerMap,
  StreamReject,
  StreamReply,
  StreamRequest,
  StreamRequestBuilder,
  StreamFulfill,
} from './controllers'
import { FailureController } from './controllers/failure'
import { PendingRequestTracker } from './controllers/pending-requests'
import {
  getConnectionId,
  getDefaultExpiry,
  MIN_MESSAGE_WINDOW,
  ILP_ERROR_CODES,
  createTimeout,
  Int,
  IlpError,
  RejectBuilder,
} from './utils'
import { IlpAddress } from './utils'
import { AccountController } from './controllers/asset-details'

/** Serialize & send, and receive & authenticate all ILP and STREAM packets */
export interface StreamConnection {
  /** Send packets as frequently as controllers will allow, until they end the send loop */
  runSendLoop(): Promise<SendState | PaymentError>
  /** Send an ILP Prepare over STREAM, then parse and validate the reply */
  sendRequest(request: StreamRequest): Promise<StreamReply | StreamReject>
}

export const createConnection = async (
  plugin: Plugin,
  controllers: ControllerMap,
  sharedSecret: Buffer,
  destinationAddress: IlpAddress,
  getExpiry: (destination?: string) => Date = getDefaultExpiry
): Promise<StreamConnection> => {
  const log = createLogger(`ilp-pay:${await getConnectionId(destinationAddress)}`)

  const encryptionKey = await generatePskEncryptionKey(sharedSecret)
  const fulfillmentKey = await generateFulfillmentKey(sharedSecret)

  const sourceAddress = controllers.get(AccountController).getSourceAccount().ilpAddress
  const createReject = (code: IlpError) =>
    new RejectBuilder().setCode(code).setTriggeredBy(sourceAddress)

  // Reject all incoming packets, but ACK incoming STREAM packets and handle connection closes
  plugin.deregisterDataHandler()
  plugin.registerDataHandler(async (data) => {
    let prepare: IlpPrepare
    try {
      prepare = deserializeIlpPrepare(data)
    } catch (_) {
      log.trace('got invalid incoming packet: rejecting with F01')
      return createReject(IlpError.F01_INVALID_PACKET).serialize()
    }

    log.debug('got incoming Prepare. amount: %s', prepare.amount)

    let streamRequest: Packet
    try {
      streamRequest = await Packet.decryptAndDeserialize(encryptionKey, prepare.data)
    } catch (err) {
      log.trace('rejecting with F06: invalid STREAM request', err) // If decryption failed, this could be anyone
      return createReject(IlpError.F06_UNEXPECTED_PAYMENT).serialize()
    }

    if (streamRequest.ilpPacketType !== IlpPacketType.Prepare) {
      log.warn('rejecting with F99: invalid STREAM packet type') // Recipient violated protocol, or intermediaries swapped valid STREAM packets
      return createReject(IlpError.F99_APPLICATION_ERROR).serialize()
    }

    log.debug(
      'got authentic STREAM request. sequence: %s, min destination amount: %s',
      streamRequest.sequence,
      streamRequest.prepareAmount
    )
    log.trace('STREAM request frames: %o', streamRequest.frames)

    // In case the server closed the stream/connection, end the payment
    controllers.get(FailureController).handleRemoteClose(streamRequest.frames, log)

    // No frames are necessary, since on connect we told the receive we can't receive money or data
    const streamReply = new Packet(streamRequest.sequence, IlpPacketType.Reject, prepare.amount)
    const ilpData = await streamReply.serializeAndEncrypt(encryptionKey)

    log.debug('rejecting with F99: cannot receive money or data')
    return createReject(IlpError.F99_APPLICATION_ERROR).setData(ilpData).serialize()
  })

  const connection: StreamConnection = {
    // TODO start and stoppable send loop? should it automatically start when connection is created?
    //      something like that could be useful for WM
    async runSendLoop() {
      for (;;) {
        const builder = new StreamRequestBuilder(
          log,
          // Callback to send and apply the request
          (request) => {
            const handlers = [...controllers.values()].map((c) => c.applyRequest(request))
            this.sendRequest(request).then((reply) => {
              handlers.forEach((apply) => apply(reply))
            })
          }
        )

        for (const c of controllers.values()) {
          const state = c.nextState?.(builder) ?? SendState.Ready

          // Immediately end the payment and wait for all requests to complete
          if (state === SendState.End || isPaymentError(state)) {
            await Promise.all(controllers.get(PendingRequestTracker).getPendingRequests())
            return state
          }
          // This request is finished or cancelled, so continue/try to send another packet
          else if (state === SendState.Wait) {
            break
          }
        }

        // Wait 5ms or for any request to complete before trying to send another
        const { timeoutPromise, cancelTimeout } = createTimeout(5)
        await Promise.race([
          timeoutPromise,
          ...controllers.get(PendingRequestTracker).getPendingRequests(),
        ])
        cancelTimeout()
      }
    },

    async sendRequest(request: StreamRequest) {
      // Create the STREAM request packet
      const {
        sequence,
        sourceAmount,
        minDestinationAmount,
        requestFrames,
        isFulfillable,
        log,
      } = request

      const streamRequest = new Packet(
        sequence,
        IlpPacketType.Prepare,
        minDestinationAmount.toLong(), // TODO What if this exceeds max u64?
        requestFrames
      )

      const data = await streamRequest.serializeAndEncrypt(encryptionKey)

      let executionCondition: Buffer
      let fulfillment: Buffer | undefined

      if (isFulfillable) {
        fulfillment = await generateFulfillment(fulfillmentKey, data)
        executionCondition = await hash(fulfillment)
        log.debug(
          'sending Prepare. amount: %s, min destination amount: %s',
          sourceAmount,
          minDestinationAmount
        )
      } else {
        executionCondition = generateRandomCondition()
        log.debug('sending unfulfillable Prepare. amount: %s', sourceAmount)
      }

      log.trace('loading Prepare with frames: %o', requestFrames)

      // Create and serialize the ILP Prepare

      const expiresAt = getExpiry(destinationAddress)
      const timeoutDuration = expiresAt.getTime() - Date.now() + MIN_MESSAGE_WINDOW // Packet MUST expire before timeout

      const preparePacket = serializeIlpPrepare({
        destination: destinationAddress,
        amount: sourceAmount.toString(), // Max packet amount controller always limits this to U64
        executionCondition,
        expiresAt,
        data,
      })

      const { timeoutPromise, cancelTimeout } = createTimeout(timeoutDuration)

      // Send the packet!
      const ilpReply: IlpReply = await Promise.race([
        timeoutPromise.then(() => createReject(IlpError.R00_TRANSFER_TIMED_OUT)),

        plugin
          .sendData(preparePacket)
          .then((data) => {
            try {
              // Don't use `deserializeIlpReply` -- it returns ILP Prepares !
              return data[0] === Type.TYPE_ILP_FULFILL
                ? deserializeIlpFulfill(data)
                : deserializeIlpReject(data)
            } catch (_) {
              return createReject(IlpError.F01_INVALID_PACKET)
            }
          })
          .catch((err) => {
            log.error('failed to send Prepare:', err)
            return createReject(IlpError.T00_INTERNAL_ERROR)
          }),
      ]).then((ilpReply) => {
        if (!isFulfill(ilpReply) || !fulfillment || ilpReply.fulfillment.equals(fulfillment)) {
          return ilpReply
        }

        log.error(
          'got invalid fulfillment: %h. expected: %h, condition: %h',
          ilpReply.fulfillment,
          fulfillment,
          executionCondition
        )
        return createReject(IlpError.F05_WRONG_CONDITION)
      })

      cancelTimeout()

      const streamReply = await Packet.decryptAndDeserialize(encryptionKey, ilpReply.data).catch(
        () => undefined
      )

      if (isFulfill(ilpReply)) {
        log.debug('got Fulfill for amount %s', sourceAmount)
      } else {
        log.debug('got %s Reject: %s', ilpReply.code, ILP_ERROR_CODES[ilpReply.code])

        if (ilpReply.message.length > 0 || ilpReply.triggeredBy.length > 0) {
          log.trace('Reject message="%s" triggeredBy=%s', ilpReply.message, ilpReply.triggeredBy)
        }
      }

      let responseFrames: Frame[] | undefined
      let destinationAmount: Int | undefined

      // Validate the STREAM reply from recipient
      if (streamReply) {
        if (streamReply.sequence.notEquals(sequence)) {
          log.error('discarding STREAM reply: received invalid sequence %s', streamReply.sequence)
        } else if (
          streamReply.ilpPacketType.valueOf() === IlpPacketType.Reject &&
          isFulfill(ilpReply)
        ) {
          // If receiver claimed they sent a Reject but we got a Fulfill, they lied!
          // If receiver said they sent a Fulfill but we got a Reject, that's possible
          log.error(
            'discarding STREAM reply: received Fulfill, but recipient claims they sent a Reject'
          )
        } else {
          responseFrames = streamReply.frames
          destinationAmount = Int.from(streamReply.prepareAmount)

          log.debug('got authentic STREAM reply. claimed destination amount: %s', destinationAmount)
          log.trace('STREAM reply frames: %o', responseFrames)
        }
      } else if (
        (isFulfill(ilpReply) || ilpReply.code !== IlpError.F08_AMOUNT_TOO_LARGE) &&
        ilpReply.data.byteLength > 0
      ) {
        // If there's data in a Fulfill or non-F08 reject, it is expected to be a valid STREAM packet
        log.warn('data in reply unexpectedly failed decryption.')
      }

      return isReject(ilpReply)
        ? new StreamReject(log, ilpReply, responseFrames, destinationAmount)
        : new StreamFulfill(log, responseFrames, destinationAmount)
    },
  }

  return connection
}
