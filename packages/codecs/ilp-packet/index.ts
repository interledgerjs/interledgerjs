import { Reader, Writer } from 'oer-utils'
import {
  dateToGeneralizedTime,
  generalizedTimeToDate,
  dateToInterledgerTime,
  interledgerTimeToDate,
  INTERLEDGER_TIME_LENGTH } from './src/utils/date'
import { stringToTwoNumbers, twoNumbersToString } from './src/utils/uint64'
import Long = require('long')
import * as assert from 'assert'

import * as errors from './src/errors'
export const Errors = errors

export enum Type {
  TYPE_ILP_PAYMENT = 1,
  TYPE_ILQP_LIQUIDITY_REQUEST = 2,
  TYPE_ILQP_LIQUIDITY_RESPONSE = 3,
  TYPE_ILQP_BY_SOURCE_REQUEST = 4,
  TYPE_ILQP_BY_SOURCE_RESPONSE = 5,
  TYPE_ILQP_BY_DESTINATION_REQUEST = 6,
  TYPE_ILQP_BY_DESTINATION_RESPONSE = 7,
  TYPE_ILP_ERROR = 8,
  TYPE_ILP_FULFILLMENT = 9,
  TYPE_ILP_FORWARDED_PAYMENT = 10, // experimental
  TYPE_ILP_REJECTION = 11,
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

export const serializeEnvelope = (type: number, contents: Buffer) => {
  const writer = new Writer()
  writer.writeUInt8(type)
  writer.writeVarOctetString(contents)
  return writer.getBuffer()
}

export const deserializeEnvelope = (binary: Buffer) => {
  const envelopeReader = Reader.from(binary)
  const type = envelopeReader.readUInt8()
  const contents = envelopeReader.readVarOctetString()

  return { type, contents }
}

export interface IlpPacket {
  type: Type,
  data: any
}

export interface IlpPayment {
  amount: string,
  account: string,
  data: Buffer
}

export interface IlpForwardedPayment {
  account: string,
  data: Buffer
}

export const serializeIlpPayment = (json: IlpPayment) => {
  assert(json.amount && typeof json.amount === 'string', 'amount must be a string')
  assert(typeof json.account === 'string', 'account is required')
  assert(!json.data || Buffer.isBuffer(json.data), 'data must be a buffer')

  const writer = new Writer()

  // amount
  const amount = Long.fromString(json.amount, true)
  writer.writeUInt32(amount.getHighBitsUnsigned())
  writer.writeUInt32(amount.getLowBitsUnsigned())

  // account
  writer.writeVarOctetString(Buffer.from(json.account, 'ascii'))

  // data
  writer.writeVarOctetString(json.data || Buffer.alloc(0))

  // extensibility
  writer.writeUInt8(0)

  return serializeEnvelope(Type.TYPE_ILP_PAYMENT, writer.getBuffer())
}

export const deserializeIlpPayment = (binary: Buffer): IlpPayment => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILP_PAYMENT) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)

  const highBits = reader.readUInt32()
  const lowBits = reader.readUInt32()
  const amount = Long.fromBits(lowBits, highBits, true).toString()
  const account = reader.readVarOctetString().toString('ascii')
  const data = reader.readVarOctetString()

  // Ignore remaining bytes for extensibility

  return {
    amount,
    account,
    data
  }
}

export const serializeIlpForwardedPayment = (json: IlpForwardedPayment) => {
  assert(typeof json.account === 'string', 'account must be a string')
  assert(!json.data || Buffer.isBuffer(json.data), 'data must be a buffer')

  const writer = new Writer()

  // account
  writer.writeVarOctetString(Buffer.from(json.account, 'ascii'))

  // data
  writer.writeVarOctetString(json.data || Buffer.alloc(0))

  // extensibility
  writer.writeUInt8(0)

  return serializeEnvelope(Type.TYPE_ILP_FORWARDED_PAYMENT, writer.getBuffer())
}

export const deserializeIlpForwardedPayment = (binary: Buffer): IlpForwardedPayment => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILP_FORWARDED_PAYMENT) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)

  const account = reader.readVarOctetString().toString('ascii')
  const data = reader.readVarOctetString()

  // Ignore remaining bytes for extensibility

  return {
    account,
    data
  }
}

export interface IlqpLiquidityRequest {
  destinationAccount: string,
  destinationHoldDuration: number
}

export const serializeIlqpLiquidityRequest = (json: IlqpLiquidityRequest) => {
  assert(typeof json.destinationAccount === 'string', 'destinationAccount must be a string')
  assert(typeof json.destinationHoldDuration === 'number', 'destinationHoldDuration must be a number')

  const writer = new Writer()

  // destinationAccount
  writer.writeVarOctetString(Buffer.from(json.destinationAccount, 'ascii'))

  // destinationHoldDuration
  writer.writeUInt32(json.destinationHoldDuration)

  // extensibility
  writer.writeUInt8(0)

  return serializeEnvelope(Type.TYPE_ILQP_LIQUIDITY_REQUEST, writer.getBuffer())
}

export const deserializeIlqpLiquidityRequest = (binary: Buffer): IlqpLiquidityRequest => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILQP_LIQUIDITY_REQUEST) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)

  const destinationAccount = reader.readVarOctetString().toString('ascii')

  const destinationHoldDuration = reader.readUInt32()

  // Ignore remaining bytes for extensibility

  return {
    destinationAccount,
    destinationHoldDuration
  }
}

export interface IlqpLiquidityResponse {
  liquidityCurve: Buffer,
  appliesToPrefix: string,
  sourceHoldDuration: number,
  expiresAt: Date
}

// Each point in a liquidity curve is two UInt64s
const SIZE_OF_POINT = 16

export const serializeIlqpLiquidityResponse = (json: IlqpLiquidityResponse) => {
  assert(Buffer.isBuffer(json.liquidityCurve), 'liquidityCurve must be a buffer')
  assert(typeof json.appliesToPrefix === 'string', 'appliesToPrefix must be a string')
  assert(typeof json.sourceHoldDuration === 'number', 'sourceHoldDuration must be a number')
  assert(json.expiresAt instanceof Date, 'expiresAt must be a Date object')

  const writer = new Writer()

  // liquidityCurve
  if (json.liquidityCurve.length % SIZE_OF_POINT !== 0) {
    throw new Error(
      'invalid liquidity curve, length must be multiple of ' +
      SIZE_OF_POINT + ', but was: ' +
      json.liquidityCurve.length
    )
  }
  writer.writeVarUInt(json.liquidityCurve.length / SIZE_OF_POINT)
  writer.write(json.liquidityCurve)

  // appliesToPrefix
  writer.writeVarOctetString(Buffer.from(json.appliesToPrefix, 'ascii'))

  // sourceHoldDuration
  writer.writeUInt32(json.sourceHoldDuration)

  // expiresAt
  writer.writeVarOctetString(Buffer.from(dateToGeneralizedTime(json.expiresAt), 'ascii'))

  // extensibility
  writer.writeUInt8(0)

  return serializeEnvelope(Type.TYPE_ILQP_LIQUIDITY_RESPONSE, writer.getBuffer())
}

export const deserializeIlqpLiquidityResponse = (binary: Buffer): IlqpLiquidityResponse => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILQP_LIQUIDITY_RESPONSE) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)

  const numPoints = reader.readVarUInt()
  const liquidityCurve = reader.read(numPoints * SIZE_OF_POINT)

  const appliesToPrefix = reader.readVarOctetString().toString('ascii')

  const sourceHoldDuration = reader.readUInt32()

  const expiresAt = generalizedTimeToDate(reader.readVarOctetString().toString('ascii'))

  // Ignore remaining bytes for extensibility

  return {
    liquidityCurve,
    appliesToPrefix,
    sourceHoldDuration,
    expiresAt
  }
}

export interface IlqpBySourceRequest {
  destinationAccount: string,
  sourceAmount: string,
  destinationHoldDuration: number,
}

export const serializeIlqpBySourceRequest = (json: IlqpBySourceRequest) => {
  assert(typeof json.destinationAccount === 'string', 'destinationAccount must be a string')
  assert(json.sourceAmount && typeof json.sourceAmount === 'string', 'sourceAmount must be a string')

  const writer = new Writer()

  // destinationAccount
  writer.writeVarOctetString(Buffer.from(json.destinationAccount, 'ascii'))

  // sourceAmount
  writer.writeUInt64(stringToTwoNumbers(json.sourceAmount))

  // destinationHoldDuration
  writer.writeUInt32(json.destinationHoldDuration)

  // extensibility
  writer.writeUInt8(0)

  return serializeEnvelope(Type.TYPE_ILQP_BY_SOURCE_REQUEST, writer.getBuffer())
}

export const deserializeIlqpBySourceRequest = (binary: Buffer): IlqpBySourceRequest => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILQP_BY_SOURCE_REQUEST) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)

  const destinationAccount = reader.readVarOctetString().toString('ascii')

  const sourceAmount = twoNumbersToString(reader.readUInt64())

  const destinationHoldDuration = reader.readUInt32()

  // Ignore remaining bytes for extensibility

  return {
    destinationAccount,
    sourceAmount,
    destinationHoldDuration
  }
}

export interface IlqpBySourceResponse {
  destinationAmount: string,
  sourceHoldDuration: number,
}

export const serializeIlqpBySourceResponse = (json: IlqpBySourceResponse) => {
  const writer = new Writer()

  // destinationAmount
  // TODO: Proper UInt64 support
  writer.writeUInt64(stringToTwoNumbers(json.destinationAmount))

  // sourceHoldDuration
  writer.writeUInt32(json.sourceHoldDuration)

  // extensibility
  writer.writeUInt8(0)

  return serializeEnvelope(Type.TYPE_ILQP_BY_SOURCE_RESPONSE, writer.getBuffer())
}

export const deserializeIlqpBySourceResponse = (binary: Buffer): IlqpBySourceResponse => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILQP_BY_SOURCE_RESPONSE) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)

  const destinationAmount = twoNumbersToString(reader.readUInt64())

  const sourceHoldDuration = reader.readUInt32()

  // Ignore remaining bytes for extensibility

  return {
    destinationAmount,
    sourceHoldDuration
  }
}

export interface IlqpByDestinationRequest {
  destinationAccount: string,
  destinationAmount: string,
  destinationHoldDuration: number,
}

export const serializeIlqpByDestinationRequest = (json: IlqpByDestinationRequest) => {
  const writer = new Writer()

  // destinationAccount
  writer.writeVarOctetString(Buffer.from(json.destinationAccount, 'ascii'))

  // destinationAmount
  writer.writeUInt64(stringToTwoNumbers(json.destinationAmount))

  // destinationHoldDuration
  writer.writeUInt32(json.destinationHoldDuration)

  // extensibility
  writer.writeUInt8(0)

  return serializeEnvelope(Type.TYPE_ILQP_BY_DESTINATION_REQUEST, writer.getBuffer())
}

export const deserializeIlqpByDestinationRequest = (binary: Buffer): IlqpByDestinationRequest => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILQP_BY_DESTINATION_REQUEST) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)

  const destinationAccount = reader.readVarOctetString().toString('ascii')

  const destinationAmount = twoNumbersToString(reader.readUInt64())

  const destinationHoldDuration = reader.readUInt32()

  // Ignore remaining bytes for extensibility

  return {
    destinationAccount,
    destinationAmount,
    destinationHoldDuration
  }
}

export interface IlqpByDestinationResponse {
  sourceAmount: string,
  sourceHoldDuration: number,
}

export const serializeIlqpByDestinationResponse = (json: IlqpByDestinationResponse) => {
  const writer = new Writer()

  // destinationAmount
  // TODO: Proper UInt64 support
  writer.writeUInt64(stringToTwoNumbers(json.sourceAmount))

  // sourceHoldDuration
  writer.writeUInt32(json.sourceHoldDuration)

  // extensibility
  writer.writeUInt8(0)

  return serializeEnvelope(Type.TYPE_ILQP_BY_DESTINATION_RESPONSE, writer.getBuffer())
}

export const deserializeIlqpByDestinationResponse = (binary: Buffer): IlqpByDestinationResponse => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILQP_BY_DESTINATION_RESPONSE) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)

  const sourceAmount = twoNumbersToString(reader.readUInt64())

  const sourceHoldDuration = reader.readUInt32()

  // Ignore remaining bytes for extensibility

  return {
    sourceAmount,
    sourceHoldDuration
  }
}

export interface IlpError {
  code: string,
  name: string,
  triggeredBy: string,
  forwardedBy: string[],
  triggeredAt: Date,
  data: string
}

const ILP_ERROR_CODE_LENGTH = 3

export const serializeIlpError = (json: IlpError) => {
  const writer = new Writer()

  // Convert code to buffer to ensure we are counting bytes, not UTF8 characters
  const codeBuffer = Buffer.from(json.code, 'ascii')
  if (codeBuffer.length !== ILP_ERROR_CODE_LENGTH) {
    throw new Error('ILP error codes must be three bytes long, received: ' + json.code)
  }

  // code
  writer.write(codeBuffer)

  // name
  writer.writeVarOctetString(Buffer.from(json.name, 'ascii'))

  // triggeredBy
  writer.writeVarOctetString(Buffer.from(json.triggeredBy, 'ascii'))

  // forwardedBy
  writer.writeVarUInt(json.forwardedBy.length)
  json.forwardedBy.forEach(forwardedBy => {
    writer.writeVarOctetString(Buffer.from(forwardedBy, 'ascii'))
  })

  // triggeredAt
  writer.writeVarOctetString(Buffer.from(dateToGeneralizedTime(json.triggeredAt), 'ascii'))

  // data
  writer.writeVarOctetString(Buffer.from(json.data, 'ascii'))

  // extensibility
  writer.writeUInt8(0)

  return serializeEnvelope(Type.TYPE_ILP_ERROR, writer.getBuffer())
}

export const deserializeIlpError = (binary: Buffer): IlpError => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILP_ERROR) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)

  const code = reader.read(ILP_ERROR_CODE_LENGTH).toString('ascii')

  const name = reader.readVarOctetString().toString('ascii')

  const triggeredBy = reader.readVarOctetString().toString('ascii')

  const forwardedByLength = reader.readVarUInt()
  const forwardedBy: string[] = new Array(forwardedByLength)
  for (let i = 0; i < forwardedByLength; i++) {
    forwardedBy[i] = reader.readVarOctetString().toString('ascii')
  }

  const triggeredAt = generalizedTimeToDate(reader.readVarOctetString().toString('ascii'))

  const data = reader.readVarOctetString().toString('ascii')

  // Ignore remaining bytes for extensibility

  return {
    code,
    name,
    triggeredBy,
    forwardedBy,
    triggeredAt,
    data
  }
}

export interface IlpFulfillment {
  data: Buffer
}

export const serializeIlpFulfillment = (json: IlpFulfillment) => {
  const writer = new Writer()

  // data
  writer.writeVarOctetString(json.data || Buffer.alloc(0))

  // extensibility
  writer.writeUInt8(0)

  return serializeEnvelope(Type.TYPE_ILP_FULFILLMENT, writer.getBuffer())
}

export const deserializeIlpFulfillment = (binary: Buffer): IlpFulfillment => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILP_FULFILLMENT) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)

  const data = reader.readVarOctetString()

  // Ignore remaining bytes for extensibility

  return {
    data
  }
}

export interface IlpRejection {
  code: string,
  triggeredBy: string,
  message: string,
  data: Buffer
}

export interface IlpF08Rejection extends IlpRejection {
  receivedAmount: string,
  maximumAmount: string
}

export const serializeIlpRejection = (json: IlpRejection) => {
  const writer = new Writer()

  // Convert code to buffer to ensure we are counting bytes, not UTF8 characters
  const codeBuffer = Buffer.from(json.code, 'ascii')
  if (codeBuffer.length !== ILP_ERROR_CODE_LENGTH) {
    throw new Error('ILP error codes must be three bytes long, received: ' + json.code)
  }

  // code
  writer.write(codeBuffer)

  // triggeredBy
  writer.writeVarOctetString(Buffer.from(json.triggeredBy, 'ascii'))

  // message
  writer.writeVarOctetString(Buffer.from(json.message, 'utf8'))

  // data
  writer.writeVarOctetString(json.data || Buffer.alloc(0))

  // extensibility
  writer.writeUInt8(0)

  return serializeEnvelope(Type.TYPE_ILP_REJECTION, writer.getBuffer())
}

export const deserializeIlpRejection = (binary: Buffer): IlpRejection => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILP_REJECTION) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)

  const code = reader.read(ILP_ERROR_CODE_LENGTH).toString('ascii')

  const triggeredBy = reader.readVarOctetString().toString('ascii')

  const message = reader.readVarOctetString().toString('utf8')

  const data = reader.readVarOctetString()

  // Ignore remaining bytes for extensibility

  if (code === 'F08') {
    const dataReader = Reader.from(data)
    const highBitsRcv = dataReader.readUInt32()
    const lowBitsRcv = dataReader.readUInt32()
    const highBitsMax = dataReader.readUInt32()
    const lowBitsMax = dataReader.readUInt32()
    return <IlpF08Rejection> {
      code,
      triggeredBy,
      message,
      data,
      receivedAmount: Long.fromBits(lowBitsRcv, highBitsRcv, true).toString(),
      maximumAmount: Long.fromBits(lowBitsMax, highBitsMax, true).toString()
    }
  }

  return {
    code,
    triggeredBy,
    message,
    data
  }
}

export interface IlpPrepare {
  amount: string,
  executionCondition: Buffer,
  expiresAt: Date,
  destination: string,
  data: Buffer
}

export const serializeIlpPrepare = (json: IlpPrepare) => {
  assert(json.amount && typeof json.amount === 'string', 'amount must be a string')
  assert(Buffer.isBuffer(json.executionCondition) &&
    json.executionCondition.length === 32, 'executionCondition must be a 32-byte buffer')
  assert(json.expiresAt && json.expiresAt instanceof Date, 'expiresAt must be a Date')
  assert(typeof json.destination === 'string', 'destination is required')
  assert(!json.data || Buffer.isBuffer(json.data), 'data must be a buffer')

  const writer = new Writer()

  const amount = Long.fromString(json.amount, true)
  writer.writeUInt32(amount.getHighBitsUnsigned())
  writer.writeUInt32(amount.getLowBitsUnsigned())
  writer.write(Buffer.from(dateToInterledgerTime(json.expiresAt), 'ascii'))
  writer.write(json.executionCondition)
  writer.writeVarOctetString(Buffer.from(json.destination, 'ascii'))
  writer.writeVarOctetString(json.data)

  return serializeEnvelope(Type.TYPE_ILP_PREPARE, writer.getBuffer())
}

export const deserializeIlpPrepare = (binary: Buffer): IlpPrepare => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILP_PREPARE) {
    throw new Error('Packet has incorrect type')
  }

  const reader = Reader.from(contents)
  const highBits = reader.readUInt32()
  const lowBits = reader.readUInt32()
  const amount = Long.fromBits(lowBits, highBits, true).toString()
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

  return serializeEnvelope(Type.TYPE_ILP_FULFILL, writer.getBuffer())
}

export const deserializeIlpFulfill = (binary: Buffer): IlpFulfill => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILP_FULFILL) {
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

export const serializeIlpReject = (json: IlpRejection) => {
  assert(json.code && typeof json.code === 'string', 'code must be a string')
  assert(typeof json.triggeredBy === 'string', 'triggeredBy must be a string')
  assert(typeof json.message === 'string', 'message must be a string')
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

  return serializeEnvelope(Type.TYPE_ILP_REJECT, writer.getBuffer())
}

export const deserializeIlpReject = (binary: Buffer): IlpRejection => {
  const { type, contents } = deserializeEnvelope(binary)

  if (type !== Type.TYPE_ILP_REJECT) {
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
    case Type.TYPE_ILP_PAYMENT: return serializeIlpPayment(obj.data)
    case Type.TYPE_ILQP_LIQUIDITY_REQUEST: return serializeIlqpLiquidityRequest(obj.data)
    case Type.TYPE_ILQP_LIQUIDITY_RESPONSE: return serializeIlqpLiquidityResponse(obj.data)
    case Type.TYPE_ILQP_BY_SOURCE_REQUEST: return serializeIlqpBySourceRequest(obj.data)
    case Type.TYPE_ILQP_BY_SOURCE_RESPONSE: return serializeIlqpBySourceResponse(obj.data)
    case Type.TYPE_ILQP_BY_DESTINATION_REQUEST: return serializeIlqpByDestinationRequest(obj.data)
    case Type.TYPE_ILQP_BY_DESTINATION_RESPONSE: return serializeIlqpByDestinationResponse(obj.data)
    case Type.TYPE_ILP_ERROR: return serializeIlpError(obj.data)
    case Type.TYPE_ILP_FULFILLMENT: return serializeIlpFulfillment(obj.data)
    case Type.TYPE_ILP_FORWARDED_PAYMENT: return serializeIlpForwardedPayment(obj.data)
    case Type.TYPE_ILP_REJECTION: return serializeIlpRejection(obj.data)
    case Type.TYPE_ILP_PREPARE: return serializeIlpPrepare(obj.data)
    case Type.TYPE_ILP_FULFILL: return serializeIlpFulfill(obj.data)
    case Type.TYPE_ILP_REJECT: return serializeIlpReject(obj.data)
    default: throw new Error('Object has invalid type')
  }
}

export const deserializeIlpPacket = (binary: Buffer) => {
  let packet
  let typeString
  switch (binary[0]) {
    case Type.TYPE_ILP_PAYMENT:
      packet = deserializeIlpPayment(binary)
      typeString = 'ilp_payment'
      break
    case Type.TYPE_ILQP_LIQUIDITY_REQUEST:
      packet = deserializeIlqpLiquidityRequest(binary)
      typeString = 'ilqp_liquidity_request'
      break
    case Type.TYPE_ILQP_LIQUIDITY_RESPONSE:
      packet = deserializeIlqpLiquidityResponse(binary)
      typeString = 'ilqp_liquidity_response'
      break
    case Type.TYPE_ILQP_BY_SOURCE_REQUEST:
      packet = deserializeIlqpBySourceRequest(binary)
      typeString = 'ilqp_by_source_request'
      break
    case Type.TYPE_ILQP_BY_SOURCE_RESPONSE:
      packet = deserializeIlqpBySourceResponse(binary)
      typeString = 'ilqp_by_source_response'
      break
    case Type.TYPE_ILQP_BY_DESTINATION_REQUEST:
      packet = deserializeIlqpByDestinationRequest(binary)
      typeString = 'ilqp_by_destination_request'
      break
    case Type.TYPE_ILQP_BY_DESTINATION_RESPONSE:
      packet = deserializeIlqpByDestinationResponse(binary)
      typeString = 'ilqp_by_destination_response'
      break
    case Type.TYPE_ILP_ERROR:
      packet = deserializeIlpError(binary)
      typeString = 'ilp_error'
      break
    case Type.TYPE_ILP_FULFILLMENT:
      packet = deserializeIlpFulfillment(binary)
      typeString = 'ilp_fulfillment'
      break
    case Type.TYPE_ILP_FORWARDED_PAYMENT:
      packet = deserializeIlpForwardedPayment(binary)
      typeString = 'ilp_forwarded_payment'
      break
    case Type.TYPE_ILP_REJECTION:
      packet = deserializeIlpRejection(binary)
      typeString = 'ilp_rejection'
      break
    case Type.TYPE_ILP_PREPARE:
      packet = deserializeIlpPrepare(binary)
      typeString = 'ilp_prepare'
      break
    case Type.TYPE_ILP_FULFILL:
      packet = deserializeIlpFulfill(binary)
      typeString = 'ilp_fulfill'
      break
    case Type.TYPE_ILP_REJECT:
      packet = deserializeIlpReject(binary)
      typeString = 'ilp_reject'
      break
    default:
      throw new Error('Packet has invalid type')
  }
  return {
    type: binary[0],
    typeString,
    data: packet
  }
}
