'use strict'

const Writer = require('oer-utils/writer')
const Reader = require('oer-utils/reader')
const BigNumber = require('bignumber.js')
const invert = require('lodash/invert')

const TYPE_REL_TO_ID_MAP = {
  'https://interledger.org/rel/ilp': 0x0000,
  'https://interledger.org/rel/ilp/source': 0x4000,
  'https://interledger.org/rel/ilp/trace': 0x4001,
  'https://interledger.org/rel/ilqp/quote_request': 0x0020,
  'https://interledger.org/rel/ilqp/quote_response': 0x0021,
  'https://interledger.org/rel/ccp/open': 0x0040,
  'https://interledger.org/rel/ccp/update': 0x0041
}

const TYPE_ID_TO_REL_MAP = invert(TYPE_REL_TO_ID_MAP)

const serializeIlpHeader = (json) => {
  const writer = new Writer()
  writer.writeUInt16(TYPE_REL_TO_ID_MAP[json.type])
  switch (json.type) {
    case 'https://interledger.org/rel/ilp':
      writer.writeUInt16(8 + json.destination_account.length)
      const amount = new BigNumber(json.destination_amount)

      let exponent
      let significand
      if (amount.decimalPlaces()) {
        exponent = -amount.decimalPlaces()
        significand = amount.times(new BigNumber(10).toPower(amount.decimalPlaces())).toNumber()
      } else {
        // BigNumber#sd(true) returns precision with trailing zeros
        // BigNumber#sd() returns precision without trailing zeros
        // Therefore the difference equals the number of trailing zeros
        const trailingZeros = amount.sd(true) - amount.sd()
        exponent = trailingZeros
        significand = amount.dividedBy(new BigNumber(10).toPower(trailingZeros)).toNumber()
      }

      // TODO support larger significands
      writer.write(Buffer.alloc(3, 0))
      writer.writeUInt32(significand)
      writer.writeInt8(exponent)

      writer.write(new Buffer(json.destination_account, 'ascii'))
      break
    default:
      throw new Error('Header type ' + json.type + ' not yet implemented')
  }
  return writer.getBuffer()
}

const deserializeIlpHeader = (binary) => {
  const reader = Reader.from(binary)
  // TODO: Support larger significands
  reader.read(3)
  const significand = reader.readUInt32()
  const exponent = reader.readInt8()
  const destinationAmount = new BigNumber(significand).times(new BigNumber(10).toPower(exponent)).toString()
  const destinationAccount = reader.read(binary.length - 8).toString('ascii')
  return {
    destination_account: destinationAccount,
    destination_amount: destinationAmount
  }
}

const deserialize = (binary) => {
  const reader = Reader.from(binary)

  const chunks = []
  while (reader.cursor < binary.length) {
    const chunk = {}
    chunk.type = TYPE_ID_TO_REL_MAP[reader.readUInt16()]
    const length = reader.readUInt16()
    const body = reader.read(length)
    switch (chunk.type) {
      case 'https://interledger.org/rel/ilp':
        chunks.push(Object.assign(chunk, deserializeIlpHeader(body)))
        break
      default:
        throw new Error('Unknown header type')
    }
  }

  return chunks
}

const serialize = (json) => {
  return Buffer.concat(json.map(h => serializeIlpHeader(h)))
}

module.exports = {
  serializeIlpHeader,
  deserialize,
  serialize
}
