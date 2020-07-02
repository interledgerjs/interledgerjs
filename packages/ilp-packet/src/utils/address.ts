const ILP_ADDRESS_REGEX = /^(g|private|example|peer|self|test[1-3]?|local)([.][a-zA-Z0-9_~-]+)+$/
const ILP_ADDRESS_MAX_LENGTH = 1023

export type IlpAddressScheme =
  | 'g'
  | 'private'
  | 'example'
  | 'test'
  | 'test1'
  | 'test2'
  | 'test3'
  | 'local'
  | 'peer'
  | 'self'

/** Get prefix or allocation scheme of the given ILP address */
export const getScheme = (address: IlpAddress): IlpAddressScheme =>
  address.split('.')[0] as IlpAddressScheme

declare class Tag<N extends string> {
  protected __nominal: N
}

type Brand<T, N extends string> = T & Tag<N>

export type IlpAddress = Brand<string, 'IlpAddress'>

export const isValidIlpAddress = (o: unknown): o is IlpAddress =>
  typeof o === 'string' && o.length <= ILP_ADDRESS_MAX_LENGTH && ILP_ADDRESS_REGEX.test(o)
