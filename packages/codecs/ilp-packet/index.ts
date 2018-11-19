import { Reader, Writer } from 'oer-utils'
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

export const errorToReject = (address: string, error: IlpErrorClass) => {
  return serializeIlpReject({
    code: error.ilpErrorCode || 'F00',
    triggeredBy: address,
    message: error.message || '',
    data: error.ilpErrorData || Buffer.alloc(0)
  })
}

export const serializeEnvelope = (type: number, contents: Writer) => {
  const writer = new Writer()
  writer.writeUInt8(type)
  writer.writeVarOctetString(contents)
  return writer.getBuffer()
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

  const writer = new Writer()

  const amount = Long.fromString(json.amount, true)
  writer.writeUInt32(amount.getHighBitsUnsigned())
  writer.writeUInt32(amount.getLowBitsUnsigned())
  writer.write(Buffer.from(dateToInterledgerTime(json.expiresAt), 'ascii'))
  writer.write(json.executionCondition)
  writer.writeVarOctetString(Buffer.from(json.destination, 'ascii'))
  writer.writeVarOctetString(json.data)

  return serializeEnvelope(Type.TYPE_ILP_PREPARE, writer)
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

  const writer = new Writer()
  writer.write(json.fulfillment)
  writer.writeVarOctetString(json.data)

  return serializeEnvelope(Type.TYPE_ILP_FULFILL, writer)
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

export const serializeIlpReject = (json: IlpReject) => {
  assert(json.code && typeof (json as Partial<IlpReject>).code === 'string', 'code must be a string')
  assert(typeof (json as Partial<IlpReject>).triggeredBy === 'string', 'triggeredBy must be a string')
  assert(typeof (json as Partial<IlpReject>).message === 'string', 'message must be a string')
  assert(!json.data || Buffer.isBuffer(json.data), 'data must be a buffer')

  const writer = new Writer()

  // Convert code to buffer to ensure we are counting bytes, not UTF8 characters
  const codeBuffer = Buffer.from(json.code, 'ascii')
  if (codeBuffer.length !== ILP_ERROR_CODE_LENGTH) {
    throw new Error('ILP error codes must be three bytes long, received: ' + json.code)
  }

  writer.write(codeBuffer)
  writer.writeVarOctetString(Buffer.from(json.triggeredBy, 'ascii'))
  writer.writeVarOctetString(Buffer.from(json.message, 'utf8'))
  writer.writeVarOctetString(json.data || Buffer.alloc(0))

  return serializeEnvelope(Type.TYPE_ILP_REJECT, writer)
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
