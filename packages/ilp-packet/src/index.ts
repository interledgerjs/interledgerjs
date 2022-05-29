import { Predictor, Reader, Writer } from 'oer-utils'
import { dateToInterledgerTime, interledgerTimeToDate, INTERLEDGER_TIME_LENGTH } from './utils/date'
import assert from 'assert'
import { IlpAddress, isValidIlpAddress } from './utils/address'
import Long from 'long'
import * as errors from './errors'

export const Errors = errors

export { IlpAddress, isValidIlpAddress }
export { getScheme, IlpAddressScheme } from './utils/address'

export { codes as IlpError, codes as IlpErrorCode, BaseIlpError as IlpErrorClass } from './errors'

export const isCanonicalIlpRejectCode = (o: unknown): o is errors.codes =>
  typeof o === 'string' && Object.values<string>(errors.codes).includes(o)

export enum Type {
  TYPE_ILP_PREPARE = 12,
  TYPE_ILP_FULFILL = 13,
  TYPE_ILP_REJECT = 14,
}

export enum IlpPacketType {
  Prepare = 12,
  Fulfill = 13,
  Reject = 14,
}

export const deserializeEnvelope = (
  binary: Buffer
): {
  type: number
  contents: Buffer
} => {
  const envelopeReader = Reader.from(binary)
  const type = envelopeReader.readUInt8Number()
  const contents = envelopeReader.readVarOctetString()

  return { type, contents }
}

export type IlpPacket =
  | {
      type: Type.TYPE_ILP_PREPARE
      typeString?: 'ilp_prepare'
      data: IlpPrepare
    }
  | {
      type: Type.TYPE_ILP_FULFILL
      typeString?: 'ilp_fulfill'
      data: IlpFulfill
    }
  | {
      type: Type.TYPE_ILP_REJECT
      typeString?: 'ilp_reject'
      data: IlpReject
    }

export interface IlpPrepare {
  amount: string
  executionCondition: Buffer
  expiresAt: Date
  destination: string
  data: Buffer
}

export const serializeIlpPrepare = (json: IlpPrepare): Buffer => {
  assert(
    json.amount && typeof (json as Partial<IlpPrepare>).amount === 'string',
    'amount must be a string'
  )
  assert(
    Buffer.isBuffer(json.executionCondition) && json.executionCondition.length === 32,
    'executionCondition must be a 32-byte buffer'
  )
  assert(json.expiresAt && json.expiresAt instanceof Date, 'expiresAt must be a Date')
  assert(typeof (json as Partial<IlpPrepare>).destination === 'string', 'destination is required')
  assert(!json.data || Buffer.isBuffer(json.data), 'data must be a buffer')

  const expiresAt = Buffer.from(dateToInterledgerTime(json.expiresAt), 'ascii')
  const destination = Buffer.from(json.destination, 'ascii')

  const contentSize =
    8 + // amount
    INTERLEDGER_TIME_LENGTH +
    32 + // executionCondition
    Predictor.measureVarOctetString(destination.length) +
    Predictor.measureVarOctetString(json.data.length)
  const envelopeSize = 1 + Predictor.measureVarOctetString(contentSize)

  const envelope = new Writer(envelopeSize)
  envelope.writeUInt8(IlpPacketType.Prepare)

  const content = envelope.createVarOctetString(contentSize)
  content.writeUInt64(json.amount)
  content.write(expiresAt)
  content.write(json.executionCondition)
  content.writeVarOctetString(destination)
  content.writeVarOctetString(json.data)

  return envelope.getBuffer()
}

export const deserializeIlpPrepare = (binary: Buffer): IlpPrepare => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== IlpPacketType.Prepare) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)
  const amount = reader.readUInt64()
  const expiresAt = interledgerTimeToDate(reader.read(INTERLEDGER_TIME_LENGTH).toString('ascii'))
  const executionCondition = reader.read(32)
  const destination = reader.readVarOctetString().toString('ascii')
  if (!isValidIlpAddress(destination)) {
    throw new Error('Packet has invalid destination address')
  }
  const data = reader.readVarOctetString()

  return {
    amount,
    executionCondition,
    expiresAt,
    destination,
    data,
  }
}

export interface IlpFulfill {
  fulfillment: Buffer
  data: Buffer
}

const isUInt64 = (o: string): boolean => {
  try {
    const l = Long.fromString(o, true)
    return l.toString() === o
  } catch (_) {
    return false // `Long.fromString` throws if empty, misplaced hyphen, etc.
  }
}

export const isIlpReply = (o: unknown): o is IlpReply => isFulfill(o) || isReject(o)

const isObject = (o: unknown): o is Record<string, unknown> => typeof o === 'object' && o !== null

export const isPrepare = (o: unknown): o is IlpPrepare =>
  isObject(o) &&
  typeof o.amount === 'string' &&
  isUInt64(o.amount) && // All ILP packet amounts must be within u64 range or should fail serialization
  o.expiresAt instanceof Date &&
  !Number.isNaN(o.expiresAt.getTime()) && // Check date instance is valid
  isValidIlpAddress(o.destination) &&
  Buffer.isBuffer(o.executionCondition) &&
  o.executionCondition.byteLength === 32 &&
  Buffer.isBuffer(o.data)

export const isFulfill = (o: unknown): o is IlpFulfill =>
  isObject(o) &&
  Buffer.isBuffer(o.fulfillment) &&
  o.fulfillment.byteLength === 32 &&
  Buffer.isBuffer(o.data)

export const isReject = (o: unknown): o is IlpReject =>
  isObject(o) &&
  typeof o.code === 'string' &&
  (isValidIlpAddress(o.triggeredBy) || o.triggeredBy === '') && // ILP address or empty string
  typeof o.message === 'string' &&
  Buffer.isBuffer(o.data)

export const isIlpError = (o: unknown): o is errors.BaseIlpError =>
  isObject(o) &&
  typeof o.message === 'string' &&
  typeof o.ilpErrorCode === 'string' &&
  ['string', 'undefined'].includes(typeof o.ilpErrorMessage) &&
  (typeof o.ilpErrorData === 'undefined' || Buffer.isBuffer(o.ilpErrorData))

export const serializeIlpFulfill = (json: IlpFulfill): Buffer => {
  assert(
    Buffer.isBuffer(json.fulfillment) && json.fulfillment.length === 32,
    'fulfillment must be a 32-byte buffer'
  )
  assert(!json.data || Buffer.isBuffer(json.data), 'data must be a buffer')

  const contentSize = 32 + Predictor.measureVarOctetString(json.data.length)
  const envelopeSize = 1 + Predictor.measureVarOctetString(contentSize)

  const envelope = new Writer(envelopeSize)
  envelope.writeUInt8(IlpPacketType.Fulfill)

  const content = envelope.createVarOctetString(contentSize)
  content.write(json.fulfillment)
  content.writeVarOctetString(json.data)

  return envelope.getBuffer()
}

export const deserializeIlpFulfill = (binary: Buffer): IlpFulfill => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== IlpPacketType.Fulfill) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)
  const fulfillment = reader.read(32)
  const data = reader.readVarOctetString()

  return {
    fulfillment,
    data,
  }
}

const ILP_ERROR_CODE_LENGTH = 3

export interface IlpReject {
  code: string
  triggeredBy: string
  message: string
  data: Buffer
}

const EMPTY_BUFFER = Buffer.alloc(0)

export const serializeIlpReject = (json: IlpReject): Buffer => {
  assert(
    json.code && typeof (json as Partial<IlpReject>).code === 'string',
    'code must be a string'
  )
  assert(
    typeof (json as Partial<IlpReject>).triggeredBy === 'string',
    'triggeredBy must be a string'
  )
  assert(typeof (json as Partial<IlpReject>).message === 'string', 'message must be a string')
  assert(!json.data || Buffer.isBuffer(json.data), 'data must be a buffer')

  // Convert code to buffer to ensure we are counting bytes, not UTF8 characters
  const codeBuffer = Buffer.from(json.code, 'ascii')
  if (codeBuffer.length !== ILP_ERROR_CODE_LENGTH) {
    throw new Error('ILP error codes must be three bytes long, received: ' + json.code)
  }

  const triggeredBy = Buffer.from(json.triggeredBy, 'ascii')
  const message = Buffer.from(json.message, 'utf8')
  const data = json.data || EMPTY_BUFFER

  const contentSize =
    ILP_ERROR_CODE_LENGTH +
    Predictor.measureVarOctetString(triggeredBy.length) +
    Predictor.measureVarOctetString(message.length) +
    Predictor.measureVarOctetString(data.length)
  const envelopeSize = 1 + Predictor.measureVarOctetString(contentSize)

  const envelope = new Writer(envelopeSize)
  envelope.writeUInt8(IlpPacketType.Reject)

  const content = envelope.createVarOctetString(contentSize)
  content.write(codeBuffer)
  content.writeVarOctetString(triggeredBy)
  content.writeVarOctetString(message)
  content.writeVarOctetString(data)

  return envelope.getBuffer()
}

export const deserializeIlpReject = (binary: Buffer): IlpReject => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== IlpPacketType.Reject) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)

  const code = reader.read(ILP_ERROR_CODE_LENGTH).toString('ascii')

  const triggeredBy = reader.readVarOctetString().toString('ascii')
  if (!isValidIlpAddress(triggeredBy) && triggeredBy !== '') {
    throw new Error('Invalid triggeredBy ILP address')
  }

  const message = reader.readVarOctetString().toString('utf8')
  const data = reader.readVarOctetString()

  return {
    code,
    triggeredBy,
    message,
    data,
  }
}

export const serializeIlpPacket = (obj: IlpPacket) => {
  switch (obj.type) {
    case Type.TYPE_ILP_PREPARE:
      return serializeIlpPrepare(obj.data)
    case Type.TYPE_ILP_FULFILL:
      return serializeIlpFulfill(obj.data)
    case Type.TYPE_ILP_REJECT:
      return serializeIlpReject(obj.data)
    default:
      throw new Error('Object has invalid type')
  }
}

export const deserializeIlpPacket = (binary: Buffer): IlpPacket => {
  if (binary[0] === Type.TYPE_ILP_PREPARE) {
    return {
      type: binary[0],
      typeString: 'ilp_prepare',
      data: deserializeIlpPrepare(binary),
    }
  } else if (binary[0] === Type.TYPE_ILP_FULFILL) {
    return {
      type: binary[0],
      typeString: 'ilp_fulfill',
      data: deserializeIlpFulfill(binary),
    }
  } else if (binary[0] === Type.TYPE_ILP_REJECT) {
    return {
      type: binary[0],
      typeString: 'ilp_reject',
      data: deserializeIlpReject(binary),
    }
  } else {
    throw new Error('Packet has invalid type')
  }
}

export type IlpPacketHander = (packet: IlpPrepare) => Promise<IlpReply>

export type IlpAny = IlpPrepare | IlpFulfill | IlpReject

export type IlpReply = IlpFulfill | IlpReject

export const deserializeIlpReply = (data: Buffer): IlpReply =>
  data[0] === IlpPacketType.Fulfill ? deserializeIlpFulfill(data) : deserializeIlpReject(data)

export const serializeIlpReply = (packet: IlpReply): Buffer =>
  isFulfill(packet) ? serializeIlpFulfill(packet) : serializeIlpReject(packet)

export const errorToReject = (address: string, error: errors.BaseIlpError): Buffer => {
  return serializeIlpReject(errorToIlpReject(address, error))
}

export const errorToIlpReject = (address: string, error: errors.BaseIlpError): IlpReject => {
  return {
    code: error.ilpErrorCode || 'F00',
    triggeredBy: address,
    message: error.ilpErrorMessage || error.message || '',
    data: error.ilpErrorData || Buffer.alloc(0),
  }
}
