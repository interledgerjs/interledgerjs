import createLogger, { Logger } from 'ilp-logger'
import {
  deserializeIlpPrepare,
  deserializeIlpReply,
  Errors,
  IlpReply,
  isFulfill,
  isReject,
  serializeIlpPrepare,
  serializeIlpReject,
} from 'ilp-packet'
import {
  generateFulfillment,
  generateFulfillmentKey,
  generatePskEncryptionKey,
  generateRandomCondition,
  hash,
} from 'ilp-protocol-stream/dist/src/crypto'
import {
  ConnectionCloseFrame,
  ErrorCode,
  Frame,
  IlpPacketType,
  Packet,
} from 'ilp-protocol-stream/dist/src/packet'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { PaymentError } from '.'
import {
  SendState,
  ControllerMap,
  StreamReject,
  StreamReply,
  StreamRequest,
  StreamRequestBuilder,
  isFulfillable,
} from './controllers'
import { FailureController } from './controllers/failure'
import { PendingRequestTracker } from './controllers/pending-requests'
import { SequenceController } from './controllers/sequence'
import {
  getConnectionId,
  Integer,
  timeout,
  toBigNumber,
  toLong,
  getDefaultExpiry,
  APPLICATION_ERROR_REJECT,
  MIN_MESSAGE_WINDOW,
  createReject,
  ILP_ERROR_CODES,
} from './utils'

/** Serialize & send, and receive & authenticate all ILP and STREAM packets */
export interface StreamConnection {
  /** Send packets as frequently as controllers will allow, until they end the send loop */
  runSendLoop(): Promise<SendState | PaymentError>
  /** Send an ILP Prepare over STREAM, then parse and validate the reply */
  sendRequest(request: StreamRequest): Promise<StreamReply | StreamReject>
  /** Send a `ConnectionClose` frame and disconnect the plugin */
  close(): Promise<void>
  /** Logger namespaced to this STREAM connection */
  log: Logger
}

export const createConnection = async (
  plugin: Plugin,
  controllers: ControllerMap,
  sharedSecret: Buffer,
  destinationAddress: string,
  getExpiry = getDefaultExpiry
): Promise<StreamConnection> => {
  const log = createLogger(`ilp-pay:${getConnectionId(destinationAddress)}`)

  const encryptionKey = await generatePskEncryptionKey(sharedSecret)
  const fulfillmentKey = await generateFulfillmentKey(sharedSecret)

  // Reject all incoming packets, but ACK incoming STREAM packets and handle connection closes
  plugin.deregisterDataHandler()
  plugin.registerDataHandler(async (data) => {
    try {
      const prepare = deserializeIlpPrepare(data)
      const streamRequest = await Packet.decryptAndDeserialize(encryptionKey, prepare.data)

      if (streamRequest.ilpPacketType !== IlpPacketType.Prepare) {
        return APPLICATION_ERROR_REJECT
      }

      log.warn(
        'got incoming Prepare for %s. rejecting with F99: cannot receive money or data. sequence: %s',
        prepare.amount,
        streamRequest.sequence
      )
      log.trace('got Prepare with frames: %j', streamRequest.frames)

      // In case the server closed the stream/connection, end the payment
      controllers.get(FailureController).handleRemoteClose(streamRequest.frames, log)

      // No frames are necessary, since on connect we told the receive we can't receive money or data
      const streamReply = new Packet(streamRequest.sequence, IlpPacketType.Reject, prepare.amount)

      return serializeIlpReject({
        code: Errors.codes.F99_APPLICATION_ERROR,
        triggeredBy: '',
        message: '',
        data: await streamReply.serializeAndEncrypt(encryptionKey),
      })
    } catch (err) {
      return APPLICATION_ERROR_REJECT
    }
  })

  const connection: StreamConnection = {
    log,

    async runSendLoop() {
      for (;;) {
        // Each controller signals next state. Default to the first state that's not `Ready`
        const builder = new StreamRequestBuilder(log)
        const state =
          [...controllers.values()]
            .map((c) => c.nextState?.(builder) ?? SendState.Ready)
            .find((s) => s !== SendState.Ready) ?? SendState.Ready
        const request = builder.build()

        const pendingRequests = controllers.get(PendingRequestTracker).getPendingRequests()

        switch (state) {
          case SendState.Ready:
            controllers.forEach((c) => c.applyPrepare?.(request))
            this.sendRequest(request).then((reply) => {
              'reject' in reply
                ? controllers.forEach((c) => c.applyReject?.(reply))
                : controllers.forEach((c) => c.applyFulfill?.(reply))
            })
            continue

          // Wait 5ms or for any pending request to finish before trying to send another packet
          case SendState.Wait:
            await timeout(5, Promise.race(pendingRequests))
            continue

          // Otherwise, wait for all requests to complete and end the payment
          default:
            await Promise.all(pendingRequests)
            return state
        }
      }
    },

    async sendRequest(request: StreamRequest) {
      // Create the STREAM request packet
      const { sequence, sourceAmount, minDestinationAmount, requestFrames, log } = request

      const streamRequest = new Packet(
        sequence,
        IlpPacketType.Prepare,
        toLong(minDestinationAmount),
        requestFrames
      )

      const data = await streamRequest.serializeAndEncrypt(encryptionKey)

      let executionCondition: Buffer
      let fulfillment: Buffer | undefined

      if (isFulfillable(request)) {
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

      log.trace('loading Prepare with frames: %j', requestFrames)

      // Create and serialize the ILP Prepare

      const expiresAt = getExpiry(destinationAddress)
      const timeoutDuration = expiresAt.getTime() - Date.now() + MIN_MESSAGE_WINDOW // Packet MUST expire before timeout

      const preparePacket = serializeIlpPrepare({
        destination: destinationAddress,
        amount: sourceAmount.toString(),
        executionCondition,
        expiresAt,
        data,
      })

      // Send the packet!
      const ilpReply: IlpReply = await timeout(
        timeoutDuration,
        plugin.sendData(preparePacket).then(deserializeIlpReply),
        createReject(Errors.codes.R00_TRANSFER_TIMED_OUT)
      )
        .catch((err) => {
          log.error('failed to send Prepare:', err)
          return createReject(Errors.codes.T00_INTERNAL_ERROR)
        })
        .then((ilpReply) => {
          if (!isFulfill(ilpReply) || !fulfillment || ilpReply.fulfillment.equals(fulfillment)) {
            return ilpReply
          }

          log.error(
            'got invalid fulfillment: %h. expected: %h, condition: %h',
            sequence,
            ilpReply.fulfillment,
            fulfillment,
            executionCondition
          )
          return createReject(Errors.codes.F05_WRONG_CONDITION)
        })

      const streamReply = await Packet.decryptAndDeserialize(
        encryptionKey,
        ilpReply.data
      ).catch(() => {})

      if (isFulfill(ilpReply)) {
        log.debug('got Fulfill for amount %s', sourceAmount)
      } else {
        log.debug('got %s Reject: %s', ilpReply.code, ILP_ERROR_CODES[ilpReply.code])
      }

      let responseFrames: Frame[] | undefined
      let destinationAmount: Integer | undefined

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
          destinationAmount = toBigNumber(streamReply.prepareAmount) as Integer // TODO Remove cast

          log.debug('got authentic STREAM reply. claimed destination amount: %s', destinationAmount)
          log.trace('STREAM reply response frames: %j', responseFrames)
        }
      } else if (
        (isFulfill(ilpReply) || ilpReply.code !== Errors.codes.F08_AMOUNT_TOO_LARGE) &&
        ilpReply.data.byteLength > 0
      ) {
        // If there's data in a Fulfill or non-F08 reject, it is expected to be a valid STREAM packet
        log.warn('data in reply unexpectedly failed decryption.')
      }

      const parsedReply = {
        ...request,
        responseFrames,
        destinationAmount,
      }
      return isReject(ilpReply)
        ? {
            ...parsedReply,
            reject: ilpReply,
          }
        : parsedReply
    },

    async close() {
      plugin.deregisterDataHandler()

      // Create request with `ConnectionClose` frame and correct sequence (amounts default to 0)
      const builder = new StreamRequestBuilder(log)
      controllers.get(SequenceController).nextState(builder)
      const request = builder.addFrames(new ConnectionCloseFrame(ErrorCode.NoError, '')).build()

      await this.sendRequest(request)

      await plugin
        .disconnect()
        .then(() => log.debug('plugin disconnected'))
        .catch((err: Error) => log.error('error disconnecting plugin:', err))
    },
  }

  return connection
}
