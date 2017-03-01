'use strict'

const Writer = require('oer-utils/writer')
const Reader = require('oer-utils/reader')
const base64url = require('base64url')
const Long = require('long')

const TYPE_ILP_PAYMENT = 1

const serializeEnvelope = (type, contents) => {
  const writer = new Writer()
  writer.writeUInt8(type)
  writer.writeVarOctetString(contents)
  return writer.getBuffer()
}

const serializeIlpHeader = (json) => {
  const writer = new Writer()

  // amount
  const amount = Long.fromString(json.amount, true)
  writer.writeUInt32(amount.getHighBitsUnsigned())
  writer.writeUInt32(amount.getLowBitsUnsigned())

  // account
  writer.writeVarOctetString(Buffer.from(json.account, 'ascii'))

  // data
  writer.writeVarOctetString(Buffer.from(json.data || '', 'base64'))

  // extensibility
  writer.writeUInt8(0)

  return serializeEnvelope(TYPE_ILP_PAYMENT, writer.getBuffer())
}

const deserializeIlpHeader = (binary) => {
  const reader = Reader.from(binary)

  const highBits = reader.readUInt32()
  const lowBits = reader.readUInt32()
  const amount = Long.fromBits(lowBits, highBits, true).toString()
  const account = reader.readVarOctetString().toString('ascii')
  const data = base64url(reader.readVarOctetString())

  return {
    type: 'ilp',
    amount,
    account,
    data
  }
}

const deserialize = (binary) => {
  const reader = Reader.from(binary)

  const type = reader.readUInt8()
  const contents = reader.readVarOctetString()

  switch (type) {
    case TYPE_ILP_PAYMENT:
      return deserializeIlpHeader(contents)
  }
}

const serialize = (json) => {
  switch (json.type) {
    case 'ilp':
      return serializeIlpHeader(json)
    default:
      throw new Error('Unknown type: ' + json.type)
  }
}

module.exports = {
  serializeIlpHeader,
  deserialize,
  serialize
}
