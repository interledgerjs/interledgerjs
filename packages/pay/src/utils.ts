/* eslint-disable @typescript-eslint/no-non-null-assertion */
import BigNumber from 'bignumber.js'
import Long from 'long'
import { IlpReject, serializeIlpReject } from 'ilp-packet'
import { hash } from 'ilp-protocol-stream/dist/src/crypto'

const ILP_ADDRESS_SCHEMES = [
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

const ILP_ADDRESS_REGEX = /^(g|private|example|peer|self|test[1-3]?|local)([.][a-zA-Z0-9_~-]+)+$/
const ILP_ADDRESS_MAX_LENGTH = 1023

export type AssetScale = Brand<number, 'AssetScale'>

export const isValidAssetScale = (o: unknown): o is AssetScale =>
  typeof o === 'number' && o >= 0 && o <= 255 && Number.isInteger(o)

/** Get prefix or allocation scheme of the given ILP address */
export const getScheme = (address: IlpAddress): typeof ILP_ADDRESS_SCHEMES[number] =>
  address.split('.')[0] as typeof ILP_ADDRESS_SCHEMES[number]

export type IlpAddress = Brand<string, 'IlpAddress'>

export const isValidIlpAddress = (o: unknown): o is IlpAddress =>
  typeof o === 'string' && o.length <= ILP_ADDRESS_MAX_LENGTH && ILP_ADDRESS_REGEX.test(o)

/** Promise that can be resolved or rejected outside its executor callback */
export class PromiseResolver<T> {
  resolve!: (value?: T | PromiseLike<T>) => void
  reject!: (value?: T | PromiseLike<T>) => void
  readonly promise = new Promise<T>((resolve, reject) => {
    this.resolve = resolve
    this.reject = reject
  })
}

/** Compute short string to uniquely identify this connection in logs */
export const getConnectionId = (destinationAddress: string): Promise<string> =>
  hash(Buffer.from(destinationAddress)).then((image) => image.toString('hex').slice(0, 6))

/** Default maximum duration that a ILP Prepare can be in-flight before it should be rejected */
const DEFAULT_PACKET_TIMEOUT_MS = 30000

/** Determine the expiration timestamp for a packet based on the default */
export const getDefaultExpiry = (): Date => new Date(Date.now() + DEFAULT_PACKET_TIMEOUT_MS)

/**
 * Duration between when an ILP Prepare expires and when a packet times out to undo its effects,
 * to prevent dropping a Fulfill if it was received right before the expiration time
 */
export const MIN_MESSAGE_WINDOW = 1000

/** Mapping of ILP error codes to its error message */
export const ILP_ERROR_CODES = {
  // Final errors
  F00: 'bad request',
  F01: 'invalid packet',
  F02: 'unreachable',
  F03: 'invalid amount',
  F04: 'insufficient destination amount',
  F05: 'wrong condition',
  F06: 'unexpected payment',
  F07: 'cannot receive',
  F08: 'amount too large',
  F99: 'application error',
  // Temporary errors
  T00: 'internal error',
  T01: 'peer unreachable',
  T02: 'peer busy',
  T03: 'connector busy',
  T04: 'insufficient liquidity',
  T05: 'rate limited',
  T99: 'application error',
  // Relative errors
  R00: 'transfer timed out',
  R01: 'insufficient source amount',
  R02: 'insufficient timeout',
  R99: 'application error',
}

/** ILP Reject error codes */
export enum IlpError {
  // Final errors
  F00_BAD_REQUEST = 'F00',
  F01_INVALID_PACKET = 'F01',
  F02_UNREACHABLE = 'F02',
  F03_INVALID_AMOUNT = 'F03',
  F04_INSUFFICIENT_DESTINATION_AMOUNT = 'F04',
  F05_WRONG_CONDITION = 'F05',
  F06_UNEXPECTED_PAYMENT = 'F06',
  F07_CANNOT_RECEIVE = 'F07',
  F08_AMOUNT_TOO_LARGE = 'F08',
  F99_APPLICATION_ERROR = 'F99',
  // Temporary errors
  T00_INTERNAL_ERROR = 'T00',
  T01_PEER_UNREACHABLE = 'T01',
  T02_PEER_BUSY = 'T02',
  T03_CONNECTOR_BUSY = 'T03',
  T04_INSUFFICIENT_LIQUIDITY = 'T04',
  T05_RATE_LIMITED = 'T05',
  T99_APPLICATION_ERROR = 'T99',
  // Relative errors
  R00_TRANSFER_TIMED_OUT = 'R00',
  R01_INSUFFICIENT_SOURCE_AMOUNT = 'R01',
  R02_INSUFFICIENT_TIMEOUT = 'R02',
  R99_APPLICATION_ERROR = 'R99',
}

/** Construct an ILP Reject packet */
export class RejectBuilder implements IlpReject {
  code = IlpError.F00_BAD_REQUEST
  message = ''
  triggeredBy = ''
  data = Buffer.alloc(0)

  setCode(code: IlpError): this {
    this.code = code
    return this
  }

  setTriggeredBy(sourceAddress: IlpAddress): this {
    this.triggeredBy = sourceAddress
    return this
  }

  setData(data: Buffer): this {
    this.data = data
    return this
  }

  serialize(): Buffer {
    return serializeIlpReject(this)
  }
}

/** Create a cancellable Promise the resolves after the given duration */
export const createTimeout = (
  durationMs: number
): {
  timeoutPromise: Promise<void>
  cancelTimeout: () => void
} => {
  const { resolve, promise } = new PromiseResolver<void>()
  const timer = setTimeout(resolve, durationMs)

  return {
    timeoutPromise: promise,
    cancelTimeout: () => clearTimeout(timer),
  }
}

/** Wait and resolve after the given number of milliseconds */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

declare class Tag<N extends string> {
  protected __nominal: N
}

export type Brand<T, N extends string> = T & Tag<N>

// Buffer used to convert between Longs and BigInts (much more performant with single allocation)
const LONG_BIGINT_BUFFER = new ArrayBuffer(8)
const LONG_BIGINT_DATAVIEW = new DataView(LONG_BIGINT_BUFFER)

/** Integer greater than or equal to 0 */
export class Int {
  value: bigint

  // TS requires the ES2020 target for BigInt literals, but that won't
  // transpile optional chaining, which breaks Node 12 support :/
  static ZERO = new Int(BigInt(0))
  static ONE = new Int(BigInt(1)) as PositiveInt
  static TWO = new Int(BigInt(2)) as PositiveInt
  static MAX_U64 = new Int(BigInt('18446744073709551615')) as PositiveInt

  private constructor(n: bigint) {
    this.value = n
  }

  static from(n: Long): Int
  static from(n: number): Int | undefined
  static from(n: string): Int | undefined
  static from(n: BigNumber): Int | undefined
  static from(n: Long | number | string | BigNumber): Int | undefined {
    if (typeof n === 'string') {
      return Int.fromString(n)
    } else if (typeof n === 'number') {
      return Int.fromNumber(n)
    } else if (BigNumber.isBigNumber(n)) {
      return Int.fromBigNumber(n)
    } else {
      return Int.fromLong(n)
    }
  }

  private static fromString(n: string): Int | undefined {
    try {
      const big = BigInt(n)
      if (big >= 0) {
        return new Int(big)
      }
      // eslint-disable-next-line no-empty
    } catch (_) {}
  }

  private static fromNumber(n: number): Int | undefined {
    if (Number.isInteger(n) && n >= 0) {
      return new Int(BigInt(n))
    }
  }

  private static fromBigNumber(n: BigNumber): Int | undefined {
    if (n.isInteger() && n.isGreaterThanOrEqualTo(0)) {
      return Int.fromString(n.toString())
    }
  }

  private static fromLong(n: Long): Int {
    LONG_BIGINT_DATAVIEW.setUint32(0, n.high)
    LONG_BIGINT_DATAVIEW.setUint32(4, n.low)
    return new Int(LONG_BIGINT_DATAVIEW.getBigUint64(0))
  }

  add(n: PositiveInt): PositiveInt
  add(n: Int): Int
  add<T extends Int>(n: T): Int {
    return new Int(this.value + n.value)
  }

  subtract(n: Int): Int {
    return this.value >= n.value ? new Int(this.value - n.value) : Int.ZERO
  }

  multiply(n: Int): Int {
    return new Int(this.value * n.value)
  }

  multiplyFloor(r: Ratio): Int {
    return new Int((this.value * r.a.value) / r.b.value)
  }

  multiplyCeil(r: Ratio): Int {
    return this.modulo(r).isPositive()
      ? new Int((this.value * r.a.value) / r.b.value).add(Int.ONE)
      : new Int((this.value * r.a.value) / r.b.value)
  }

  divideCeil(n: PositiveInt): Int {
    return this.modulo(n).isPositive()
      ? new Int(this.value / n.value).add(Int.ONE)
      : new Int(this.value / n.value)
  }

  modulo(n: Int | Ratio): Int {
    return n instanceof Int
      ? new Int(this.value % n.value)
      : new Int((this.value * n.a.value) % n.b.value)
  }

  isEqualTo(n: Int): boolean {
    return this.value === n.value
  }

  isGreaterThan(n: Int): this is PositiveInt {
    return this.value > n.value
  }

  isGreaterThanOrEqualTo(n: PositiveInt): this is PositiveInt
  isGreaterThanOrEqualTo(n: Int): boolean
  isGreaterThanOrEqualTo<T extends Int>(n: T): boolean {
    return this.value >= n.value
  }

  isLessThan(n: Int): boolean {
    return this.value < n.value
  }

  isLessThanOrEqualTo(n: Int): boolean {
    return this.value <= n.value
  }

  isPositive(): this is PositiveInt {
    return this.isGreaterThan(Int.ZERO)
  }

  orLesser(n: Int): Int {
    return this.isLessThanOrEqualTo(n) ? this : n
  }

  orGreater(n: PositiveInt): PositiveInt
  orGreater(n: Int): Int
  orGreater<T extends Int>(n: T): Int {
    return this.isGreaterThanOrEqualTo(n) ? this : n
  }

  toString(): string {
    return this.value.toString()
  }

  toBigNumber(): BigNumber {
    return new BigNumber(this.value.toString())
  }

  toLong(): Long {
    LONG_BIGINT_DATAVIEW.setBigUint64(0, this.value)
    const high = LONG_BIGINT_DATAVIEW.getUint32(0)
    const low = LONG_BIGINT_DATAVIEW.getUint32(4)
    return new Long(low, high, true)
  }
}

/** Integer greater than 0 */
export interface PositiveInt extends Int {
  multiply(n: PositiveInt): PositiveInt
  multiply(n: Int): Int
  multiplyCeil(r: PositiveRatio): PositiveInt
  multiplyCeil(r: Ratio): Int
  divideCeil(n: PositiveInt): PositiveInt
  isEqualTo(n: Int): n is PositiveInt
  isLessThan(n: Int): n is PositiveInt
  isLessThanOrEqualTo(n: Int): n is PositiveInt
  isPositive(): true
  orLesser(n: PositiveInt): PositiveInt
  orLesser(n: Int): Int
  orGreater(n: Int): PositiveInt
}

/** Finite number greater than or equal to 0 */
export type NonNegativeNumber = Brand<number, 'NonNegativeNumber'>

/** Is the given number greater than or equal to 0, not `NaN`, and not `Infinity`? */
export const isNonNegativeNumber = (o: number): o is NonNegativeNumber =>
  Number.isFinite(o) && o >= 0

/**
 * Ratio of two integers: a numerator greater than or equal to 0,
 * and a denominator greater than 0
 */
export class Ratio {
  a: Int
  b: PositiveInt

  constructor(a: Int, b: PositiveInt) {
    this.a = a
    this.b = b
  }

  static fromNumber(n: NonNegativeNumber): Ratio {
    let e = 1
    while (!Number.isInteger(n * e)) {
      e *= 10
    }

    const a = Int.from(n * e)!
    const b = Int.from(e)!
    return new Ratio(a, b as PositiveInt)
  }

  reciprocal(): Ratio | undefined {
    if (this.a.isPositive()) {
      return new Ratio(this.b, this.a)
    }
  }

  subtract(r: Ratio): Ratio {
    const a = this.a.multiply(r.b).subtract(r.a.multiply(this.b))
    const b = this.b.multiply(r.b)
    return new Ratio(a, b)
  }

  isGreaterThan(r: Ratio): this is PositiveRatio {
    return this.a.value * r.b.value > this.b.value * r.a.value
  }

  isGreaterThanOrEqualTo(r: PositiveRatio): this is PositiveRatio
  isGreaterThanOrEqualTo(r: Ratio): boolean
  isGreaterThanOrEqualTo<T extends Ratio>(r: T): boolean {
    return this.a.value * r.b.value >= this.b.value * r.a.value
  }

  isLessThan(r: Ratio): boolean {
    return this.a.value * r.b.value < this.b.value * r.a.value
  }

  isLessThanOrEqualTo(r: Ratio): boolean {
    return this.a.value * r.b.value <= this.b.value * r.a.value
  }

  isPositive(): this is PositiveRatio {
    return this.a.isPositive()
  }

  toBigNumber(): BigNumber {
    return new BigNumber(this.a.toString()).dividedBy(this.b.toString())
  }

  toString(): string {
    const bn = this.toBigNumber()
    return bn.toFixed(Math.min(bn.decimalPlaces(), 10)) // Limit logs to 10 decimals of precision
  }
}

/** Ratio of two integers greater than 0 */
interface PositiveRatio extends Ratio {
  a: PositiveInt
  b: PositiveInt

  reciprocal(): PositiveRatio
  isLessThan(r: Ratio): r is PositiveRatio
  isLessThanOrEqualTo(r: Ratio): r is PositiveRatio
  isPositive(): true
}
