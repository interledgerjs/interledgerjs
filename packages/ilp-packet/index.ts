import { Predictor, Reader, Writer, WriterInterface } from 'oer-utils'
import {
  dateToInterledgerTime,
  interledgerTimeToDate,
  INTERLEDGER_TIME_LENGTH
} from './src/utils/date'
import Long = require('long')
import * as assert from 'assert'

import * as errors from './src/errors'
export const Errors = errors

export enum Type {
  TYPE_ILP_PREPARE = 12,
  TYPE_ILP_FULFILL = 13,
  TYPE_ILP_REJECT = 14
}

export interface IlpErrorClass {
  message: string,
  ilpErrorCode?: string,
  ilpErrorData?: Buffer
}

export const errorToReject = (address: string, error: IlpErrorClass): Buffer => {
  return serializeIlpReject({
    code: error.ilpErrorCode || 'F00',
    triggeredBy: address,
    message: error.message || '',
    data: error.ilpErrorData || Buffer.alloc(0)
  })
}

export const deserializeEnvelope = (binary: Buffer) => {
  const envelopeReader = Reader.from(binary)
  const type = envelopeReader.readUInt8Number()
  const contents = envelopeReader.readVarOctetString()

  return { type, contents }
}

export type IlpPacket = {
  type: Type.TYPE_ILP_PREPARE,
  typeString?: 'ilp_prepare',
  data: IlpPrepare
} | {
  type: Type.TYPE_ILP_FULFILL,
  typeString?: 'ilp_fulfill',
  data: IlpFulfill
} | {
  type: Type.TYPE_ILP_REJECT,
  typeString?: 'ilp_reject',
  data: IlpReject
}

export interface IlpPrepare {
  amount: string,
  executionCondition: Buffer,
  expiresAt: Date,
  destination: string,
  data: Buffer
}

export const serializeIlpPrepare = (json: IlpPrepare) => {
  assert(json.amount && typeof (json as Partial<IlpPrepare>).amount === 'string', 'amount must be a string')
  assert(Buffer.isBuffer(json.executionCondition) &&
    json.executionCondition.length === 32, 'executionCondition must be a 32-byte buffer')
  assert(json.expiresAt && json.expiresAt instanceof Date, 'expiresAt must be a Date')
  assert(typeof (json as Partial<IlpPrepare>).destination === 'string', 'destination is required')
  assert(!json.data || Buffer.isBuffer(json.data), 'data must be a buffer')

  const amount = Long.fromString(json.amount, true)
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
  envelope.writeUInt8(Type.TYPE_ILP_PREPARE)

  const content = envelope.createVarOctetString(contentSize)
  content.writeUInt32(amount.getHighBitsUnsigned())
  content.writeUInt32(amount.getLowBitsUnsigned())
  content.write(expiresAt)
  content.write(json.executionCondition)
  content.writeVarOctetString(destination)
  content.writeVarOctetString(json.data)

  return envelope.getBuffer()
}

export const deserializeIlpPrepare = (binary: Buffer): IlpPrepare => {
  const { type, contents } = deserializeEnvelope(binary)

  if (+type !== Type.TYPE_ILP_PREPARE) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)
  const highBits = reader.readUInt32Number()
  const lowBits = reader.readUInt32Number()
  const amount = Long.fromBits(+lowBits, +highBits, true).toString()
  const expiresAt = interledgerTimeToDate(reader.read(INTERLEDGER_TIME_LENGTH).toString('ascii'))
  const executionCondition = reader.read(32)
  const destination = reader.readVarOctetString().toString('ascii')
  const data = reader.readVarOctetString()

  return {
    amount,
    executionCondition,
    expiresAt,
    destination,
    data
  }
}

export interface IlpFulfill {
  fulfillment: Buffer,
  data: Buffer
}

export const serializeIlpFulfill = (json: IlpFulfill) => {
  assert(Buffer.isBuffer(json.fulfillment) &&
    json.fulfillment.length === 32, 'fulfillment must be a 32-byte buffer')
  assert(!json.data || Buffer.isBuffer(json.data), 'data must be a buffer')

  const contentSize = 32 + Predictor.measureVarOctetString(json.data.length)
  const envelopeSize = 1 + Predictor.measureVarOctetString(contentSize)

  const envelope = new Writer(envelopeSize)
  envelope.writeUInt8(Type.TYPE_ILP_FULFILL)

  const content = envelope.createVarOctetString(contentSize)
  content.write(json.fulfillment)
  content.writeVarOctetString(json.data)

  return envelope.getBuffer()
}

export const deserializeIlpFulfill = (binary: Buffer): IlpFulfill => {
  const { type, contents } = deserializeEnvelope(binary)

  if (+type !== Type.TYPE_ILP_FULFILL) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)
  const fulfillment = reader.read(32)
  const data = reader.readVarOctetString()

  return {
    fulfillment,
    data
  }
}

const ILP_ERROR_CODE_LENGTH = 3

export interface IlpReject {
  code: string,
  triggeredBy: string,
  message: string,
  data: Buffer
}

const EMPTY_BUFFER = Buffer.alloc(0)

export const serializeIlpReject = (json: IlpReject) => {
  assert(json.code && typeof (json as Partial<IlpReject>).code === 'string', 'code must be a string')
  assert(typeof (json as Partial<IlpReject>).triggeredBy === 'string', 'triggeredBy must be a string')
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

  const contentSize = ILP_ERROR_CODE_LENGTH +
    Predictor.measureVarOctetString(triggeredBy.length) +
    Predictor.measureVarOctetString(message.length) +
    Predictor.measureVarOctetString(data.length)
  const envelopeSize = 1 + Predictor.measureVarOctetString(contentSize)

  const envelope = new Writer(envelopeSize)
  envelope.writeUInt8(Type.TYPE_ILP_REJECT)

  const content = envelope.createVarOctetString(contentSize)
  content.write(codeBuffer)
  content.writeVarOctetString(triggeredBy)
  content.writeVarOctetString(message)
  content.writeVarOctetString(data)

  return envelope.getBuffer()
}

export const deserializeIlpReject = (binary: Buffer): IlpReject => {
  const { type, contents } = deserializeEnvelope(binary)

  if (+type !== Type.TYPE_ILP_REJECT) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)
  const code = reader.read(ILP_ERROR_CODE_LENGTH).toString('ascii')
  const triggeredBy = reader.readVarOctetString().toString('ascii')
  const message = reader.readVarOctetString().toString('utf8')
  const data = reader.readVarOctetString()

  return {
    code,
    triggeredBy,
    message,
    data
  }
}

export const serializeIlpPacket = (obj: IlpPacket) => {
  switch (obj.type) {
    case Type.TYPE_ILP_PREPARE: return serializeIlpPrepare(obj.data)
    case Type.TYPE_ILP_FULFILL: return serializeIlpFulfill(obj.data)
    case Type.TYPE_ILP_REJECT: return serializeIlpReject(obj.data)
    default: throw new Error('Object has invalid type')
  }
}

export const deserializeIlpPacket = (binary: Buffer): IlpPacket => {
  if (binary[0] === Type.TYPE_ILP_PREPARE) {
    return {
      type: binary[0],
      typeString: 'ilp_prepare',
      data: deserializeIlpPrepare(binary)
    }
  } else if (binary[0] === Type.TYPE_ILP_FULFILL) {
    return {
      type: binary[0],
      typeString: 'ilp_fulfill',
      data: deserializeIlpFulfill(binary)
    }
  } else if (binary[0] === Type.TYPE_ILP_REJECT) {
    return {
      type: binary[0],
      typeString: 'ilp_reject',
      data: deserializeIlpReject(binary)
    }
  } else {
    throw new Error('Packet has invalid type')
  }
}

export type IlpPacketHander = (packet: IlpPrepare) => Promise<IlpReply>

export type IlpAny = IlpPrepare | IlpFulfill | IlpReject

export type IlpReply = IlpFulfill | IlpReject

export function deserializeIlpReply (data: Buffer): IlpReply {
  return deserializeIlpPacket(data).data as IlpReply
}

export function serializeIlpReply (packet: IlpReply): Buffer {
  return isFulfill(packet) ? serializeIlpFulfill(packet) : serializeIlpReject(packet)
}

export const errorToIlpReject = (address: string, error: IlpErrorClass): IlpReject => {
  return {
    code: error.ilpErrorCode || 'F00',
    triggeredBy: address,
    message: error.message || '',
    data: error.ilpErrorData || Buffer.alloc(0)
  }
}

export function isPrepare (packet: IlpAny): packet is IlpPrepare {
  return typeof packet['amount'] === 'string' &&
    typeof packet['expiresAt'] !== 'undefined' &&
    typeof packet['destination'] === 'string' &&
    Buffer.isBuffer(packet['executionCondition']) &&
    Buffer.isBuffer(packet['data'])
}

export function isFulfill (packet: IlpAny): packet is IlpFulfill {
  return Buffer.isBuffer(packet['fulfillment']) &&
    Buffer.isBuffer(packet['data'])
}

export function isReject (packet: IlpAny): packet is IlpReject {
  return typeof packet['code'] === 'string' &&
    typeof packet['triggeredBy'] === 'string' &&
    typeof packet['message'] === 'string' &&
    Buffer.isBuffer(packet['data'])
}
