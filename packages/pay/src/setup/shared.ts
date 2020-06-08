/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types */
import { Brand } from '../utils'

const ALLOCATION_SCHEMES = [
  'g',
  'private',
  'example',
  'test',
  'test1',
  'test2',
  'test3',
  'local',
  'peer',
  'self',
] as const

const SHARED_SECRET_BYTES = 32

/** Get prefix or allocation scheme of the given ILP address */
export const getScheme = (address: IlpAddress): typeof ALLOCATION_SCHEMES[number] =>
  address.split('.')[0] as typeof ALLOCATION_SCHEMES[number]

export type IlpAddress = Brand<string, 'IlpAddress'>

export const isValidIlpAddress = (o: any): o is IlpAddress =>
  typeof o === 'string' &&
  !/[^A-Za-z0-9._\-~]/.test(o) && // Valid characters: alphanumeric and "_ ~ - ."
  o.split('.').length >= 2 && // At least two segments
  (ALLOCATION_SCHEMES as readonly string[]).includes(o.split('.')[0]) && // First segment is a valid allocation scheme
  o.length <= 1023 &&
  o[o.length - 1] !== '.' // Doesn't end in "."

export const isSharedSecretBase64 = (o: any): boolean =>
  typeof o === 'string' && Buffer.from(o, 'base64').byteLength === SHARED_SECRET_BYTES

export const isSharedSecretBuffer = (o: any): boolean =>
  Buffer.isBuffer(o) && o.byteLength === SHARED_SECRET_BYTES

export const parsePaymentPointer = (pointer: string): string | undefined => {
  try {
    const endpoint = new URL(pointer.startsWith('$') ? 'https://' + pointer.substring(1) : pointer)
    endpoint.pathname = endpoint.pathname !== '/' ? endpoint.pathname : '/.well-known/pay'
    return endpoint.href
  } catch (_) {
    // No-op if the URL is invalid
  }
}
