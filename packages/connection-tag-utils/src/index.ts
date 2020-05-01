import base64url from 'base64url'
import * as crypto from 'crypto'

export type Key = string | Buffer

export function encode(key: Key, data: string) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()])

  const tag = cipher.getAuthTag()
  const complete = Buffer.concat([tag, iv, encrypted])

  return base64url(complete)
}

export function decode(key: Key, completeEncoded: string) {
  const complete = Buffer.from(completeEncoded, 'base64')
  const tag = complete.slice(0, 16)
  const iv = complete.slice(16, 16 + 12)
  const encrypted = complete.slice(16 + 12)

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  const data = Buffer.concat([decipher.update(encrypted), decipher.final()])

  return data.toString('utf8')
}
