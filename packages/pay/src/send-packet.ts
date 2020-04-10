import {
  deserializeIlpReply,
  Errors,
  IlpReject,
  IlpReply,
  isFulfill,
  serializeIlpPrepare,
  serializeIlpReject,
  deserializeIlpPrepare
} from 'ilp-packet'
import {
  generateFulfillment,
  generateRandomCondition,
  hash
} from 'ilp-protocol-stream/dist/src/crypto'
import {
  Frame,
  IlpPacketType,
  Packet,
  ConnectionCloseFrame,
  ErrorCode
} from 'ilp-protocol-stream/dist/src/packet'
import {
  StreamController,
  StreamRequest,
  isReplyController,
  StreamRequestBuilder
} from './controllers'
import { timeout, Integer, toBigNumber, toLong } from './utils'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { DataHandler } from '@kincaidoneil/ilp-connector/dist/types/plugin'
import { Logger } from 'ilp-logger'
import { SequenceController } from './controllers/sequence'
import { FailureController } from './controllers/failure'

/** TODO */
export interface StreamConnection {
  readonly log: Logger
  readonly destinationAddress: string
  readonly plugin: Plugin
  readonly pskKey: Buffer // TODO Rename pskKey to... Preshared Key? psk key is weird
  readonly fulfillmentKey: Buffer
  readonly getExpiry: (destination: string) => Date
}

/** TODO */
const DEFAULT_PACKET_TIMEOUT_MS = 30000

/** TODO */
export const getDefaultExpiry = () => new Date(Date.now() + DEFAULT_PACKET_TIMEOUT_MS)

/**
 * Duration between when an ILP Prepare expires and when a packet times out to undo its effects,
 * to prevent dropping a Fulfill if it was received right before the expiration time
 */
const MIN_MESSAGE_WINDOW = 1000

/** Mapping of ILP error codes to its error message */
export const ILP_ERROR_CODES = {
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
  R99: 'application error'
}

/** Create an empty ILP Reject from an error code */
const createReject = (code: string, message = ''): IlpReject => ({
  code,
  message,
  triggeredBy: '',
  data: Buffer.alloc(0)
})

/** Generic application error */
const APPLICATION_ERROR_REJECT = serializeIlpReject(
  createReject(Errors.codes.F99_APPLICATION_ERROR)
)

/** Send an ILP Prepare over STREAM, validate the reply, and apply the corresponding Fulfill/Reject to each controller */
export const sendPacket = async (
  connection: StreamConnection,
  controllers: StreamController[],
  request: StreamRequest
): Promise<void> => {
  // Create the STREAM request packet
  const { sequence, sourceAmount, minDestinationAmount, requestFrames, log } = request

  const streamRequest = new Packet(
    sequence,
    IlpPacketType.Prepare,
    toLong(minDestinationAmount),
    requestFrames
  )

  const data = await streamRequest.serializeAndEncrypt(connection.pskKey)

  let executionCondition: Buffer
  let fulfillment: Buffer | undefined

  const isFulfillable = sourceAmount.isGreaterThan(0) && minDestinationAmount.isGreaterThan(0)
  if (isFulfillable) {
    fulfillment = await generateFulfillment(connection.fulfillmentKey, data)
    executionCondition = await hash(fulfillment)

    log.debug(
      'sending Prepare. amount: %s, min destination amount: %s',
      sourceAmount,
      minDestinationAmount
    )
    log.trace('loading Prepare with frames: %j', requestFrames)
  } else {
    // If we couldn't compute a minimum destination amount (e.g. don't know asset details yet),
    // packet MUST be unfulfillable so no money is at risk
    executionCondition = generateRandomCondition()

    log.debug(
      'sending unfulfillable Prepare. amount: %s, request frames: %j',
      sourceAmount,
      requestFrames
    )
  }

  // Create and serialize the ILP Prepare

  const destination = connection.destinationAddress
  const expiresAt = connection.getExpiry(destination)
  const timeoutDuration = expiresAt.getTime() - Date.now() + MIN_MESSAGE_WINDOW // Timeout MUST occur after the packet expires

  const preparePacket = serializeIlpPrepare({
    amount: sourceAmount.toString(),
    executionCondition,
    destination,
    expiresAt,
    data
  })

  // Send the packet!
  const reply: IlpReply = await timeout(
    timeoutDuration,
    connection.plugin.sendData(preparePacket).then(deserializeIlpReply),
    createReject(Errors.codes.R00_TRANSFER_TIMED_OUT)
  )
    .catch(err => {
      log.error('failed to send Prepare:', err)
      return createReject(Errors.codes.T00_INTERNAL_ERROR)
    })
    .then(reply => {
      if (!isFulfill(reply) || !fulfillment || reply.fulfillment.equals(fulfillment)) {
        return reply
      }

      log.error(
        'got invalid fulfillment: %h. expected: %h, condition: %h',
        sequence,
        reply.fulfillment,
        fulfillment,
        executionCondition
      )
      return createReject(Errors.codes.F05_WRONG_CONDITION)
    })

  const streamReply = await Packet.decryptAndDeserialize(connection.pskKey, reply.data).catch(
    () => null
  )

  if (isFulfill(reply)) {
    log.debug('got Fulfill for amount %s', sourceAmount)
  } else {
    log.debug('got %s Reject: %s', reply.code, ILP_ERROR_CODES[reply.code])
  }

  let isAuthentic = false
  let responseFrames: Frame[] | undefined
  let destinationAmount: Integer | undefined

  // Attempt to parse STREAM reply from recipient
  if (streamReply) {
    if (streamReply.sequence.notEquals(sequence)) {
      log.error('discarding STREAM reply: received invalid sequence %s', streamReply.sequence)
    } else if (streamReply.ilpPacketType.valueOf() === IlpPacketType.Reject && isFulfill(reply)) {
      // If receiver claimed they sent a Reject but we got a Fulfill, they lied!
      // If receiver said they sent a Fulfill but we got a Reject, that's possible
      log.error(
        'discarding STREAM reply: received Fulfill, but recipient claims they sent a Reject'
      )
    } else {
      isAuthentic = true
      responseFrames = streamReply.frames
      destinationAmount = toBigNumber(streamReply.prepareAmount) as Integer // TODO Remove cast

      log.debug('got authentic STREAM reply. claimed destination amount: %s', destinationAmount)
      log.trace('STREAM reply response frames: %j', responseFrames)
    }
  }

  // Update state in each controller based on the Fulfill or Reject
  if (isFulfill(reply)) {
    controllers.filter(isReplyController).forEach(c =>
      c.applyFulfill({
        ...request,
        isAuthentic,
        responseFrames,
        destinationAmount
      })
    )
  } else {
    controllers.filter(isReplyController).forEach(c =>
      c.applyReject({
        ...request,
        isAuthentic,
        responseFrames,
        destinationAmount,
        reject: reply
      })
    )
  }
}

/** Send a packet with a `ConnectionClose` frame to the receiver. */
export const sendConnectionClose = async (
  connection: StreamConnection,
  sequenceController: SequenceController
) => {
  // Create request with `ConnectionClose` frame and correct sequence (amounts default to 0)
  const builder = new StreamRequestBuilder(connection.log)
  sequenceController.nextState(builder)
  const request = builder.addFrames(new ConnectionCloseFrame(ErrorCode.NoError, '')).build()

  await sendPacket(connection, [], request)
}

/**
 * Handle incoming packets from the receiver. Since this can't receive any incoming money or data,
 * always reject them. If applicable, send an authenticated STREAM reply in accordance with the RFC.
 */
export const createRejectHandler = (
  { pskKey, log }: StreamConnection,
  failureController: FailureController
): DataHandler => async data => {
  try {
    const prepare = deserializeIlpPrepare(data)
    const streamRequest = await Packet.decryptAndDeserialize(pskKey, prepare.data)

    if (streamRequest.ilpPacketType !== IlpPacketType.Prepare) {
      return APPLICATION_ERROR_REJECT
    }

    log.warn(
      'got incoming Prepare for %s. rejecting with F99: cannot receive incoming money or data. sequence: %s, frames: %j',
      prepare.amount,
      streamRequest.sequence,
      streamRequest.frames
    )

    // In case the server closed the stream/connection, end the payment
    failureController.handleRemoteClose(streamRequest.frames, log.extend('incoming'))

    const streamReply = new Packet(
      streamRequest.sequence,
      IlpPacketType.Reject,
      prepare.amount
      // No frames should be necessary.
      // The frames sent on the first packet told the receiver we can't receive money or data
    )

    return serializeIlpReject({
      code: Errors.codes.F99_APPLICATION_ERROR,
      triggeredBy: '',
      message: '',
      data: await streamReply.serializeAndEncrypt(pskKey)
    })
  } catch (err) {
    return APPLICATION_ERROR_REJECT
  }
}
