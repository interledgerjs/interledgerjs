import * as crypto from 'crypto'
import * as assert from 'assert'

const HASH_ALGORITHM = 'sha256'
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

export const randomBytes = crypto.randomBytes

export async function hash (preimage: Buffer): Promise<Buffer> {
  const h = crypto.createHash(HASH_ALGORITHM)
  h.update(preimage)
  return Promise.resolve(h.digest())
}

export async function encrypt (pskEncryptionKey: Buffer, ...buffers: Buffer[]): Promise<Buffer> {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, pskEncryptionKey, iv)

  const ciphertext = []
  for (let buffer of buffers) {
    ciphertext.push(cipher.update(buffer))
  }
  ciphertext.push(cipher.final())
  const tag = cipher.getAuthTag()
  ciphertext.unshift(iv, tag)
  return Promise.resolve(Buffer.concat(ciphertext))
}

export async function decrypt (pskEncryptionKey: Buffer, data: Buffer): Promise<Buffer> {
  assert(data.length > 0, 'cannot decrypt empty buffer')
  const nonce = data.slice(0, IV_LENGTH)
  const tag = data.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = data.slice(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, pskEncryptionKey, nonce)
  decipher.setAuthTag(tag)

  return Promise.resolve(Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]))
}

export async function hmac (key: Buffer, message: Buffer): Promise<Buffer> {
  const h = crypto.createHmac(HASH_ALGORITHM, key)
  h.update(message)
  return Promise.resolve(h.digest())
}
