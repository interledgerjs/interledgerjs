import {
  IlpReply,
  isFulfill,
  isReject,
  serializeIlpPrepare,
  IlpPacketType,
  IlpError,
  deserializeIlpReply,
  IlpReject,
  serializeIlpReject,
} from 'ilp-packet'
import {
  generateFulfillment,
  generateFulfillmentKey,
  generatePskEncryptionKey,
  generateRandomCondition,
  hash,
} from 'ilp-protocol-stream/dist/src/crypto'
import { Frame, Packet, FrameType } from 'ilp-protocol-stream/dist/src/packet'
import { Plugin } from 'ilp-protocol-stream/dist/src/util/plugin-interface'
import { StreamReject, StreamReply, StreamRequest, StreamFulfill } from './controllers'
import { createTimeout, Int } from './utils'

/** Send an ILP Prepare over STREAM, then parse and authenticate the reply */
export type SendRequest = (request: StreamRequest) => Promise<StreamReply>

// TODO Rename this? What does "creating a connection" mean?
export const createConnection = async (
  plugin: Plugin,
  sharedSecret: Buffer
): Promise<SendRequest> => {
  const encryptionKey = await generatePskEncryptionKey(sharedSecret)
  const fulfillmentKey = await generateFulfillmentKey(sharedSecret)

  // Incoming packets *should* never be received since our source address is never shared
  // with the STREAM receiver. Therefore, these are likely only packets mistakenly routed to us.
  plugin.deregisterDataHandler()
  plugin.registerDataHandler(async () => serializeIlpReject(createReject(IlpError.F02_UNREACHABLE)))

  return async (request: StreamRequest): Promise<StreamReply> => {
    // Create the STREAM request packet
    const {
      sequence,
      sourceAmount,
      destinationAddress,
      minDestinationAmount,
      requestFrames,
      isFulfillable,
      expiresAt,
      log,
    } = request

    const streamRequest = new Packet(
      sequence,
      +IlpPacketType.Prepare,
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
        'sending Prepare. amount=%s minDestinationAmount=%s frames=[%s]',
        sourceAmount,
        minDestinationAmount,
        requestFrames.map((f) => FrameType[f.type]).join()
      )
    } else {
      executionCondition = generateRandomCondition()
      log.debug(
        'sending unfulfillable Prepare. amount=%s frames=[%s]',
        sourceAmount,
        requestFrames.map((f) => FrameType[f.type]).join()
      )
    }

    log.trace('loading Prepare with frames: %o', requestFrames)

    // Create and serialize the ILP Prepare
    const preparePacket = serializeIlpPrepare({
      destination: destinationAddress,
      amount: sourceAmount.toString(), // Max packet amount controller always limits this to U64
      executionCondition,
      expiresAt,
      data,
    })

    // Timeout if the packet expires
    const timeoutDuration = expiresAt.getTime() - Date.now()
    const { timeoutPromise, cancelTimeout } = createTimeout(timeoutDuration)
    const requestTimeout: Promise<IlpReply> = timeoutPromise.then(() =>
      createReject(IlpError.R00_TRANSFER_TIMED_OUT)
    )

    // Send the packet!
    const ilpRequest: Promise<IlpReply> = plugin
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

    // TODO Note: the packet was already sent, so this adds a little more overhead?
    const ilpReply: IlpReply = plugin.isConnected()
      ? await Promise.race([requestTimeout, ilpRequest])
      : // Don't send a packet if the plugin is not connected, but handle it as a temporary failure.
        // For example: ilp-plugin-btp would still try to send the request, but if fails, still waits until it times out.
        // (This assumes plugins automatically attempt to reconnect in the background.)
        createReject(IlpError.T00_INTERNAL_ERROR)

    cancelTimeout()

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
