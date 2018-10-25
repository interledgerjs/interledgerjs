import * as crypto from 'crypto'
import * as assert from 'assert'
require('source-map-support').install()

const HASH_ALGORITHM = 'sha256'
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const ENCRYPTION_KEY_STRING = Buffer.from('ilp_stream_encryption', 'utf8')
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
export const ENCRYPTION_OVERHEAD = 28

const FULFILLMENT_GENERATION_STRING = Buffer.from('ilp_stream_fulfillment', 'utf8')

const TOKEN_LENGTH = 18
const SHARED_SECRET_GENERATION_STRING = Buffer.from('ilp_stream_shared_secret', 'utf8')

export function generateToken (): Buffer {
  return crypto.randomBytes(TOKEN_LENGTH)
}

export function generateTokenAndSharedSecret (seed: Buffer): { token: Buffer, sharedSecret: Buffer } {
  const token = crypto.randomBytes(TOKEN_LENGTH)
  const sharedSecret = generateSharedSecretFromToken(seed, token)
  return { token, sharedSecret }
}

export function generateSharedSecretFromToken (seed: Buffer, token: Buffer): Buffer {
  const keygen = hmac(seed, SHARED_SECRET_GENERATION_STRING)
  const sharedSecret = hmac(keygen, token)
  return sharedSecret
}

export function generateRandomCondition () {
  return crypto.randomBytes(32)
}

export function generatePskEncryptionKey (sharedSecret: Buffer) {
  return hmac(sharedSecret, ENCRYPTION_KEY_STRING)
}

export function generateFulfillmentKey (sharedSecret: Buffer) {
  return hmac(sharedSecret, FULFILLMENT_GENERATION_STRING)
}

export function generateFulfillment (fulfillmentKey: Buffer, data: Buffer) {
  const fulfillment = hmac(fulfillmentKey, data)
  return fulfillment
}

export function hash (preimage: Buffer) {
  const h = crypto.createHash(HASH_ALGORITHM)
  h.update(preimage)
  return h.digest()
}

export function encrypt (pskEncryptionKey: Buffer, ...buffers: Buffer[]): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, pskEncryptionKey, iv)

  const ciphertext = []
  for (let buffer of buffers) {
    ciphertext.push(cipher.update(buffer))
  }
  ciphertext.push(cipher.final())
  const tag = cipher.getAuthTag()
  ciphertext.unshift(iv, tag)
  return Buffer.concat(ciphertext)
}

export function decrypt (pskEncryptionKey: Buffer, data: Buffer): Buffer {
  assert(data.length > 0, 'cannot decrypt empty buffer')
  const nonce = data.slice(0, IV_LENGTH)
  const tag = data.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = data.slice(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, pskEncryptionKey, nonce)
  decipher.setAuthTag(tag)

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ])
}

function hmac (key: Buffer, message: Buffer): Buffer {
  const h = crypto.createHmac(HASH_ALGORITHM, key)
  h.update(message)
  return h.digest()
}
