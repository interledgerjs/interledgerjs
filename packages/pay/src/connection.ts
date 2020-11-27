import createLogger, { Logger } from 'ilp-logger'
import {
  deserializeIlpReply,
  IlpAddress,
  IlpError,
  IlpPacketType,
  IlpReject,
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
import { Frame, FrameType, Packet } from 'ilp-protocol-stream/dist/src/packet'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { isPaymentError, PaymentError } from '.'
import { StreamFulfill, StreamReject, StreamReply, StreamRequest } from './request'
import { Int, timeout } from './utils'
import { PaymentDestination } from './open-payments'

/** Serialize, send, receive and validate ILP/STREAM packets over the network */
export interface StreamConnection {
  /** Send an ILP Prepare over STREAM, then parse and authenticate the reply */
  sendRequest: (request: StreamRequest) => Promise<StreamReply>

  /** Disconnect the plugin and unregister handlers (note: does not send `ConnectionClose` frame) */
  close(): Promise<void>

  /** Logger namespaced to this connection */
  log: Logger
}

/** Connect the given plugin, generate keys, register handlers, and setup ILP connection so STREAM requests may be sent */
export const createConnection = async (
  plugin: Plugin, // TODO Replace with a sendData function?
  { sharedSecret, destinationAddress }: PaymentDestination
): // TODO Should this take in a payment destination instead...?
Promise<StreamConnection | PaymentError> => {
  const encryptionKey = await generatePskEncryptionKey(sharedSecret)
  const fulfillmentKey = await generateFulfillmentKey(sharedSecret)

  const connectionId = await hash(Buffer.from(destinationAddress))
  const log = createLogger(`ilp-pay:${connectionId.toString('hex').slice(0, 6)}`)

  const connectResult = await timeout(
    10_000,
    plugin.connect().catch((err: Error) => {
      log.error('error connecting plugin:', err)
      return PaymentError.Disconnected
    })
  ).catch(() => {
    log.error('plugin failed to connect: timed out.')
    return PaymentError.Disconnected
  })
  if (isPaymentError(connectResult)) {
    return connectResult
  }

  // Incoming packets *should* never be received since our source address is never shared
  // with the STREAM receiver. Therefore, these are likely only packets mistakenly routed to us.
  plugin.deregisterDataHandler()
  plugin.registerDataHandler(async () => serializeIlpReject(createReject(IlpError.F02_UNREACHABLE)))

  return {
    log,

    close: () =>
      timeout(
        5_000,
        plugin
          .disconnect()
          .then(() => log.debug('plugin disconnected.'))
          .catch((err: Error) => log.error('error disconnecting plugin:', err))
      )
        .catch(() => log.error('plugin failed to disconnect: timed out.'))
        .finally(() => plugin.deregisterDataHandler()),

    sendRequest: async (request: StreamRequest): Promise<StreamReply> => {
      // Create the STREAM request packet
      const {
        sequence,
        sourceAmount,
        destinationAddress,
        minDestinationAmount,
        frames,
        isFulfillable,
        expiresAt,
        log,
      } = request

      const streamRequest = new Packet(
        sequence,
        IlpPacketType.Prepare.valueOf(),
        minDestinationAmount.toLong(), // TODO What if this exceeds max u64?
        frames
      )

      const data = await streamRequest.serializeAndEncrypt(encryptionKey)

      let executionCondition: Buffer
      let fulfillment: Buffer | undefined

      if (isFulfillable) {
        fulfillment = await generateFulfillment(fulfillmentKey, data)
        executionCondition = await hash(fulfillment)
        log.debug(
          'sending Prepare. amount=%s minDestinationAmount=%s frames=[%s]',
          sourceAmount,
          minDestinationAmount,
          frames.map((f) => FrameType[f.type]).join()
        )
      } else {
        executionCondition = generateRandomCondition()
        log.debug(
          'sending unfulfillable Prepare. amount=%s frames=[%s]',
          sourceAmount,
          frames.map((f) => FrameType[f.type]).join()
        )
      }

      log.trace('loading Prepare with frames: %o', frames)

      // Create and serialize the ILP Prepare
      const preparePacket = serializeIlpPrepare({
        destination: destinationAddress,
        amount: sourceAmount.toString(), // Max packet amount controller always limits this to U64
        executionCondition,
        expiresAt,
        data,
      })

      // Send the packet!
      const pendingReply: Promise<IlpReply> = plugin.isConnected()
        ? plugin
            .sendData(preparePacket)
            .then((data) => {
              try {
                return deserializeIlpReply(data)
              } catch (_) {
                return createReject(IlpError.F01_INVALID_PACKET)
              }
            })
            .catch((err) => {
              log.error('failed to send Prepare:', err)
              return createReject(IlpError.T00_INTERNAL_ERROR)
            })
            .then((ilpReply) => {
              if (
                !isFulfill(ilpReply) ||
                !fulfillment ||
                ilpReply.fulfillment.equals(fulfillment)
              ) {
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
        : // Don't send a packet if the plugin is not connected, but handle it as a temporary failure.
          // For example: ilp-plugin-btp would still try to send the request, but if fails, still waits until it times out.
          // (This assumes plugins automatically attempt to reconnect in the background.)
          Promise.resolve(createReject(IlpError.T00_INTERNAL_ERROR))

      // Await reply and timeout if the packet expires
      const timeoutDuration = expiresAt.getTime() - Date.now()
      const ilpReply: IlpReply = await timeout(timeoutDuration, pendingReply).catch(() => {
        log.error('request timed out.')
        return createReject(IlpError.R00_TRANSFER_TIMED_OUT)
      })

      const streamReply = await Packet.decryptAndDeserialize(encryptionKey, ilpReply.data).catch(
        () => undefined
      )

      if (isFulfill(ilpReply)) {
        log.debug('got Fulfill. amount=%s', sourceAmount)
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
        } else if (+streamReply.ilpPacketType === IlpPacketType.Reject && isFulfill(ilpReply)) {
          // If receiver claimed they sent a Reject but we got a Fulfill, they lied!
          // If receiver said they sent a Fulfill but we got a Reject, that's possible
          log.error(
            'discarding STREAM reply: received Fulfill, but recipient claims they sent a Reject'
          )
        } else {
          responseFrames = streamReply.frames
          destinationAmount = Int.from(streamReply.prepareAmount)

          log.debug(
            'got authentic STREAM reply. receivedAmount=%s frames=[%s]',
            destinationAmount,
            responseFrames.map((f) => FrameType[f.type]).join()
          )
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
}

/** Mapping of ILP error codes to its error message */
const ILP_ERROR_CODES = {
  // Final errors
  F00: 'bad request',
  F01: 'invalid packet',
  F02: 'unreachable',
  F03: 'invalid amount',
  F04: 'insufficient destination amount',
  F05: 'wrong condition',
  F06: 'unexpected payment',
  F07: 'cannot receive',
  F08: 'amount too large',
  F99: 'application error',
  // Temporary errors
  T00: 'internal error',
  T01: 'peer unreachable',
  T02: 'peer busy',
  T03: 'connector busy',
  T04: 'insufficient liquidity',
  T05: 'rate limited',
  T99: 'application error',
  // Relative errors
  R00: 'transfer timed out',
  R01: 'insufficient source amount',
  R02: 'insufficient timeout',
  R99: 'application error',
}

/** Construct a simple ILP Reject packet */
const createReject = (code: IlpError): IlpReject => ({
  code,
  message: '',
  triggeredBy: '',
  data: Buffer.alloc(0),
})
