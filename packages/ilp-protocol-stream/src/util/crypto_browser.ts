// According to their type declarations, SubtleCrypto functions return `PromiseLike`.
// They are close enough to a `Promise` to `await`, but tslint doesn't know that.
/* tslint:disable:await-promise */

const { crypto } = window
const HASH_ALGORITHM = 'SHA-256'
const ENCRYPTION_ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12
const AUTH_TAG_BYTES = 16
const AUTH_TAG_BITS = 8 * AUTH_TAG_BYTES
const CACHE_EXPIRY = 30000

// Cache keys so that `subtle.importKey` doesn't need to be called for every operation.
// It would be nicer to just store the `CryptoKey`s on the stream `Connection`, but
// that's tricky since this file takes the place of `crypto_node.ts`.
class KeyCache {
  private cache: Map<Buffer, CacheEntry> = new Map()

  cleanup () {
    const now = Date.now()
    for (const entry of this.cache) {
      const cacheData = entry[0]
      const cacheEntry = entry[1]
      if (now - cacheEntry.accessTime > CACHE_EXPIRY) {
        this.cache.delete(cacheData)
      }
    }
  }

  async importKey (
    keyData: Buffer,
    algorithm: string | HmacImportParams | AesKeyAlgorithm,
    keyUsages: string[]
  ): Promise<CryptoKey> {
    const oldEntry = this.cache.get(keyData)
    if (oldEntry) {
      oldEntry.accessTime = Date.now()
      return oldEntry.keyObject
    }
    const keyObject = await crypto.subtle.importKey(
      'raw',
      keyData,
      algorithm,
      false, // extractable
      keyUsages
    )
    this.cache.set(keyData, {
      keyObject,
      accessTime: Date.now()
    })
    return keyObject
  }
}

interface CacheEntry {
  keyObject: CryptoKey,
  accessTime: number // milliseconds since epoch
}

const hmacKeyCache = new KeyCache()
const aesKeyCache = new KeyCache()

setInterval(() => {
  hmacKeyCache.cleanup()
  aesKeyCache.cleanup()
}, 30000)

export async function hash (preimage: Buffer): Promise<Buffer> {
  const digest = await crypto.subtle.digest({ name: HASH_ALGORITHM }, preimage)
  return Buffer.from(digest)
}

export async function encrypt (pskEncryptionKey: Buffer, ...buffers: Buffer[]): Promise<Buffer> {
  const iv = randomBytes(IV_LENGTH)
  const key = await aesKeyCache.importKey(
    pskEncryptionKey, ENCRYPTION_ALGORITHM, ['encrypt', 'decrypt'])
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
  const key = await aesKeyCache.importKey(
    pskEncryptionKey, ENCRYPTION_ALGORITHM, ['encrypt', 'decrypt'])
  const decryptedData = await crypto.subtle.decrypt(
    {
      name: ENCRYPTION_ALGORITHM,
      iv: nonce
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
  const hmacKey = await hmacKeyCache.importKey(
    key, HMAC_ALGORITHM, ['sign', 'verify'])
  const signature = await crypto.subtle.sign('HMAC', hmacKey, message)
  return Buffer.from(signature)
}

export function randomBytes (size: number): Buffer {
  const randArray = new Uint8Array(size)
  const randValues = crypto.getRandomValues(randArray)
  return Buffer.from(randValues)
}

// Dummy function to make typescript happy. This function is only ever used by
// the server, which is not included in the browser build.
export function generateSharedSecretFromToken (seed: Buffer, token: Buffer): Buffer {
  throw new Error('unreachable')
}
