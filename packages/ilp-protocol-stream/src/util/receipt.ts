import { Reader, Writer } from 'oer-utils'
import {
  LongValue,
  longFromValue
} from './long'
import * as Long from 'long'
import { generateReceiptHMAC } from '../crypto'

export const RECEIPT_VERSION = 1

export interface ReceiptOpts {
  nonce: Buffer
  streamId: LongValue
  totalReceived: LongValue
  secret: Buffer
}

export interface Receipt {
  version: number
  nonce: Buffer
  streamId: string
  totalReceived: Long
}

interface ReceiptWithHMAC extends Receipt {
  hmac: Buffer
}

export function createReceipt (opts: ReceiptOpts): Buffer {
  if (opts.nonce.length !== 16) {
    throw new Error('receipt nonce must be 16 bytes')
  }
  if (opts.secret.length !== 32) {
    throw new Error('receipt secret must be 32 bytes')
  }
  const receipt = new Writer(58)
  receipt.writeUInt8(RECEIPT_VERSION)
  receipt.writeOctetString(opts.nonce, 16)
  receipt.writeUInt8(opts.streamId)
  receipt.writeUInt64(longFromValue(opts.totalReceived, true))
  receipt.writeOctetString(generateReceiptHMAC(opts.secret, receipt.getBuffer()), 32)
  return receipt.getBuffer()
}

function decode (receipt: Buffer): ReceiptWithHMAC {
  if (receipt.length !== 58) {
    throw new Error('receipt malformed')
  }
  const reader = Reader.from(receipt)
  const version = reader.readUInt8Number()
  const nonce = reader.readOctetString(16)
  const streamId = reader.readUInt8()
  const totalReceived = reader.readUInt64Long()
  const hmac = reader.readOctetString(32)
  return {
    version,
    nonce,
    streamId,
    totalReceived,
    hmac
  }
}

export function decodeReceipt (receipt: Buffer): Receipt {
  return decode(receipt)
}

export function verifyReceipt (receipt: Buffer, secret: Buffer): Receipt {
  const decoded = decode(receipt)
  if (decoded.version !== RECEIPT_VERSION) {
    throw new Error('invalid version')
  }
  const message = receipt.slice(0, 26)
  if (!decoded.hmac.equals(generateReceiptHMAC(secret, message))) {
    throw new Error('invalid hmac')
  }
  return decoded
}
