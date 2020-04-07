// When webpacked, "crypto-node" is replaced with "crypto-browser".
import { hmac, randomBytes } from './util/crypto-node'
export {
  decrypt,
  encrypt,
  generateSharedSecretFromToken, // only in node, not browser
  hash,
  randomBytes
} from './util/crypto-node'

const TOKEN_LENGTH = 18
const ENCRYPTION_KEY_STRING = Buffer.from('ilp_stream_encryption', 'utf8')
const FULFILLMENT_GENERATION_STRING = Buffer.from('ilp_stream_fulfillment', 'utf8')
const PACKET_ID_STRING = Buffer.from('ilp_stream_packet_id', 'utf8')
export const ENCRYPTION_OVERHEAD = 28

export function generateToken (): Buffer {
  return randomBytes(TOKEN_LENGTH)
}

export function generateRandomCondition (): Buffer {
  return randomBytes(32)
}

export function generatePskEncryptionKey (sharedSecret: Buffer): Promise<Buffer> {
  return hmac(sharedSecret, ENCRYPTION_KEY_STRING)
}

export function generateFulfillmentKey (sharedSecret: Buffer): Promise<Buffer> {
  return hmac(sharedSecret, FULFILLMENT_GENERATION_STRING)
}

export function generateFulfillment (fulfillmentKey: Buffer, data: Buffer): Promise<Buffer> {
  return hmac(fulfillmentKey, data)
}

export function generateIncomingPacketId (sharedSecret: Buffer, sequence: Long): Promise<Buffer> {
  return hmac(sharedSecret, Buffer.concat([PACKET_ID_STRING, Buffer.from(sequence.toBytes())]))
}
