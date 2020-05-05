/* eslint-disable @typescript-eslint/no-explicit-any */
import { Brand } from '../utils'

const ALLOCATION_SCHEMES = ['g', 'private', 'example', 'test', 'local', 'peer', 'self']

const SHARED_SECRET_BYTES = 32

/** Are the allocation schemes of 2 ILP addresses compatible? Are they on the same network? */
export const areSchemesCompatible = (address1: string, address2: string) =>
  address1.split('.')[0] === address2.split('.')[0]

export type IlpAddress = Brand<string, 'IlpAddress'>

export const isValidIlpAddress = (o: any): o is IlpAddress =>
  typeof o === 'string' &&
  !/[^A-Za-z0-9._\-~]/.test(o) && // Valid characters: alphanumeric and "_ ~ - ."
  o.split('.').length >= 2 && // At least two segments
  ALLOCATION_SCHEMES.includes(o.split('.')[0]) && // First segment is a valid allocation scheme
  o.length <= 1023 &&
  o[o.length - 1] !== '.' // Doesn't end in "."

export const isSharedSecretBase64 = (o: any): boolean =>
  typeof o === 'string' && Buffer.from(o, 'base64').byteLength === SHARED_SECRET_BYTES

export const isSharedSecretBuffer = (o: any): boolean =>
  Buffer.isBuffer(o) && o.byteLength === SHARED_SECRET_BYTES

export const parsePaymentPointer = (pointer: string, isSpsp = false): string | undefined => {
  try {
    const endpoint = new URL(pointer.startsWith('$') ? 'https://' + pointer.substring(1) : pointer)
    endpoint.pathname =
      endpoint.pathname !== '/'
        ? endpoint.pathname
        : isSpsp
        ? '/.well-known/pay'
        : '/.well-known/open-payments'
    return endpoint.href
  } catch (_) {
    // No-op if the URL is invalid
  }
}
