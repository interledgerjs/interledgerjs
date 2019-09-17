const { crypto } = window
const HASH_ALGORITHM = 'SHA-256'
const ENCRYPTION_ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12
const AUTH_TAG_BYTES = 16
const AUTH_TAG_BITS = 8 * AUTH_TAG_BYTES

// TODO cache imported keys somehow; dont call importKey repeatedly

export async function hash (preimage: Buffer): Promise<Buffer> {
  const digest = await crypto.subtle.digest(
    { name: HASH_ALGORITHM },
    preimage
  )
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
  const ctBuffer = await crypto.subtle.encrypt(
    {
      name: ENCRYPTION_ALGORITHM,
      iv,
      tagLength: AUTH_TAG_BITS
    },
    key,
    Buffer.concat(buffers)
  )
  const tagStart = ctBuffer.byteLength - AUTH_TAG_BYTES
  const tag = ctBuffer.slice(tagStart)
  const data = ctBuffer.slice(0, tagStart)
  // TODO accomplish this w/ less copying
  const dataArr = Buffer.concat([
    Buffer.from(iv),
    Buffer.from(tag),
    Buffer.from(data)
  ])
  return dataArr
}

export async function decrypt (pskEncryptionKey: Buffer, data: Buffer): Promise<Buffer> {
  const nonce = data.slice(0, IV_LENGTH)
  const tag = data.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_BYTES)
  const encrypted = data.slice(IV_LENGTH + AUTH_TAG_BYTES)
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
    Buffer.concat([encrypted, tag])
  )
  return Buffer.from(decryptedData)
}

const HMAC_ALGORITHM = {
  name: 'HMAC',
  hash: {name: HASH_ALGORITHM}
}

// Tested indirectly by other functions, not directly accessed by STREAM
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
