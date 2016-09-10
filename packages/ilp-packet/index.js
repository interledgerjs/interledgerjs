'use strict'

const Writer = require('oer-utils/writer')
const Reader = require('oer-utils/reader')
const BigNumber = require('bignumber.js')

const TYPES = {
  ILP_HEADER: 0x0001
}

const serializeIlpHeader = (json) => {
  const writer = new Writer()
  writer.writeUInt8(0)
  writer.writeVarOctetString(new Buffer(json.account, 'ascii'))
  const amount = new BigNumber(json.amount)
  if (amount.decimalPlaces()) {
    writer.writeInt8(-amount.decimalPlaces())
    writer.writeVarUInt(amount.times(new BigNumber(10).toPower(amount.decimalPlaces())).toNumber())
  } else {
    // BigNumber#sd(true) returns precision with trailing zeros
    // BigNumber#sd() returns precision without trailing zeros
    // Therefore the difference equals the number of trailing zeros
    const trailingZeros = amount.sd(true) - amount.sd()
    writer.writeInt8(trailingZeros)
    writer.writeVarUInt(amount.dividedBy(new BigNumber(10).toPower(trailingZeros)).toNumber())
  }

  return writer.getBuffer()
}

const deserializeIlpHeader = (binary) => {
  const reader = Reader.from(binary)
  reader.readUInt8()
  const account = reader.readVarOctetString().toString('ascii')
  const exponent = reader.readInt8()
  const mantissa = reader.readVarUInt()
  const amount = new BigNumber(mantissa).times(new BigNumber(10).toPower(exponent)).toString()
  return {
    account,
    amount
  }
}

const deserialize = (binary) => {
  const reader = Reader.from(binary)

  const data = {}
  do {
    const type = reader.readUInt16()
    switch (type) {
      case TYPES.ILP_HEADER:
        data.ilp_header = deserializeIlpHeader(reader.readVarOctetString())
        break
      default:
        throw new Error('Unknown header type')
    }
  } while (reader.readUInt8())

  return data
}

const serialize = (json) => {
  const writer = new Writer()
  writer.writeUInt16(TYPES.ILP_HEADER)
  writer.writeVarOctetString(serializeIlpHeader(json.ilp_header))
  writer.writeUInt8(0)

  return writer.getBuffer()
}

module.exports = {
  serializeIlpHeader,
  deserialize,
  serialize
}
