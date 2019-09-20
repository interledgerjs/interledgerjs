// When webpacked, "crypto_node" is replaced with "crypto_browser".
import { hmac, randomBytes } from './util/crypto_node'
export { decrypt, encrypt, hash, randomBytes } from './util/crypto_node'

const TOKEN_LENGTH = 18
const ENCRYPTION_KEY_STRING = Buffer.from('ilp_stream_encryption', 'utf8')
const FULFILLMENT_GENERATION_STRING = Buffer.from('ilp_stream_fulfillment', 'utf8')
const SHARED_SECRET_GENERATION_STRING = Buffer.from('ilp_stream_shared_secret', 'utf8')
export const ENCRYPTION_OVERHEAD = 28

export function generateToken (): Buffer {
  return randomBytes(TOKEN_LENGTH)
}

export async function generateSharedSecretFromToken (seed: Buffer, token: Buffer): Promise<Buffer> {
  const keygen = await hmac(seed, SHARED_SECRET_GENERATION_STRING)
  const sharedSecret = await hmac(keygen, token)
  return sharedSecret
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
