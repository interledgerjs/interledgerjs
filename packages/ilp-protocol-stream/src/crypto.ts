// When webpacked, "crypto-node" is replaced with "crypto-browser".
import { hmac, randomBytes } from './util/crypto-node'
export {
  decrypt,
  decryptConnectionAddressToken, // only in node, not browser
  encrypt,
  encryptConnectionAddressToken, // only in node, not browser
  generateSharedSecretFromToken, // only in node, not browser
  generateReceiptHMAC, // only in node, not browser
  hash,
  hmac,
  randomBytes
} from './util/crypto-node'

export const TOKEN_NONCE_LENGTH = 18
const ENCRYPTION_KEY_STRING = Buffer.from('ilp_stream_encryption', 'utf8')
const FULFILLMENT_GENERATION_STRING = Buffer.from('ilp_stream_fulfillment', 'utf8')
const PACKET_ID_STRING = Buffer.from('ilp_stream_packet_id', 'utf8')
export const ENCRYPTION_OVERHEAD = 28

export function generateTokenNonce (): Buffer {
  return randomBytes(TOKEN_NONCE_LENGTH)
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
