import { Reader, Writer } from 'oer-utils'
import base64url from 'base64url-adhoc'
import Long = require('long')

const TYPE_ILP_PAYMENT = 1

const serializeEnvelope = (type: number, contents: Buffer) => {
  const writer = new Writer()
  writer.writeUInt8(type)
  writer.writeVarOctetString(contents)
  return writer.getBuffer()
}

interface IlpPayment {
  amount: string,
  account: string,
  data: string
}

const serializeIlpPayment = (json: IlpPayment) => {
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

const deserializeIlpPayment = (binary: Buffer) => {
  const envelopeReader = Reader.from(binary)

  const type = envelopeReader.readUInt8()

  if (type !== TYPE_ILP_PAYMENT) {
    throw new Error('Packet has incorrect type')
  }

  const contents = envelopeReader.readVarOctetString()
  const reader = Reader.from(contents)

  const highBits = reader.readUInt32()
  const lowBits = reader.readUInt32()
  const amount = Long.fromBits(lowBits, highBits, true).toString()
  const account = reader.readVarOctetString().toString('ascii')
  const data = base64url(reader.readVarOctetString())

  return {
    amount,
    account,
    data
  }
}

module.exports = {
  serializeIlpPayment,
  deserializeIlpPayment
}
