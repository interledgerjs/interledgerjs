// According to their type declarations, SubtleCrypto functions return `PromiseLike`.
// They are close enough to a `Promise` to `await`, but tslint doesn't know that.
/* tslint:disable:await-promise */

const { crypto } = window
const HASH_ALGORITHM = 'SHA-256'
const ENCRYPTION_ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12
const AUTH_TAG_BYTES = 16
const AUTH_TAG_BITS = 8 * AUTH_TAG_BYTES

// TODO cache imported keys somehow; dont call importKey repeatedly

export async function hash (preimage: Buffer): Promise<Buffer> {
  const digest = await crypto.subtle.digest({ name: HASH_ALGORITHM }, preimage)
  return Buffer.from(digest)
}

export async function encrypt (pskEncryptionKey: Buffer, ...buffers: Buffer[]): Promise<Buffer> {
  const iv = randomBytes(IV_LENGTH)
  const key = await crypto.subtle.importKey(
    'raw',
    pskEncryptionKey,
    ENCRYPTION_ALGORITHM,
    false,
    ['encrypt', 'decrypt']
  )
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: ENCRYPTION_ALGORITHM,
      iv,
      tagLength: AUTH_TAG_BITS
    },
    key,
    Buffer.concat(buffers)
  )
  const tagStart = ciphertext.byteLength - AUTH_TAG_BYTES
  const tag = ciphertext.slice(tagStart)
  const data = ciphertext.slice(0, tagStart)
  return Buffer.concat([
    Buffer.from(iv),
    Buffer.from(tag),
    Buffer.from(data)
  ])
}

export async function decrypt (pskEncryptionKey: Buffer, data: Buffer): Promise<Buffer> {
  const nonce = data.slice(0, IV_LENGTH)
  const tag = data.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_BYTES)
  const cipherdata = data.slice(IV_LENGTH + AUTH_TAG_BYTES)
  const key = await crypto.subtle.importKey(
    'raw',
    pskEncryptionKey,
    ENCRYPTION_ALGORITHM,
    false,
    ['encrypt', 'decrypt']
  )
  const decryptedData = await crypto.subtle.decrypt(
    {
      name: ENCRYPTION_ALGORITHM,
      iv: nonce,
      tagLength: AUTH_TAG_BITS
    },
    key,
    Buffer.concat([cipherdata, tag])
  )
  return Buffer.from(decryptedData)
}

const HMAC_ALGORITHM = {
  name: 'HMAC',
  hash: { name: HASH_ALGORITHM }
}

export async function hmac (key: Buffer, message: Buffer): Promise<Buffer> {
  const hmacKey = await crypto.subtle.importKey(
    'raw', key, HMAC_ALGORITHM, false, ['sign', 'verify'])
  const signature = await crypto.subtle.sign('HMAC', hmacKey, message)
  return Buffer.from(signature)
}

export function randomBytes (size: number): Buffer {
  const randArray = new Uint8Array(size)
  const randValues = crypto.getRandomValues(randArray)
  return Buffer.from(randValues)
}
