/* eslint-disable @typescript-eslint/no-non-null-assertion */
import BigNumber from 'bignumber.js'
import Long from 'long'
import { Errors, IlpReject, serializeIlpReject } from 'ilp-packet'
import { IlpAddress } from './setup/shared'
import { hash } from 'ilp-protocol-stream/dist/src/crypto'

export class PromiseResolver<T> {
  resolve!: (value?: T | PromiseLike<T>) => void
  reject!: (value?: T | PromiseLike<T>) => void
  readonly promise = new Promise<T>((resolve, reject) => {
    this.resolve = resolve
    this.reject = reject
  })
}

export const getConnectionId = (destinationAddress: IlpAddress): Promise<string> =>
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

/** Create an empty ILP Reject from an error code */
export const createReject = (code: string, message = ''): IlpReject => ({
  code,
  message,
  triggeredBy: '',
  data: Buffer.alloc(0),
})

/** Generic application error */
export const APPLICATION_ERROR_REJECT = serializeIlpReject(
  createReject(Errors.codes.F99_APPLICATION_ERROR)
)

/** Unexpected payment error */
export const UNEXPECTED_PAYMENT_REJECT = serializeIlpReject(
  createReject(Errors.codes.F06_UNEXPECTED_PAYMENT)
)

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

  static fromNumber(n: number): Int | undefined {
    if (Number.isInteger(n) && n >= 0) {
      return new Int(BigInt(n))
    }
  }

  static fromBigNumber(n: BigNumber): Int | undefined {
    if (n.isInteger() && n.isGreaterThanOrEqualTo(0)) {
      return new Int(BigInt(n.toString()))
    }
  }

  static fromLong(n: Long): Int {
    LONG_BIGINT_DATAVIEW.setUint32(0, n.high)
    LONG_BIGINT_DATAVIEW.setUint32(4, n.low)
    return new Int(LONG_BIGINT_DATAVIEW.getBigUint64(0))
  }

  // If param is PositiveInt, return type should also be a PositiveInt
  add<T extends Int>(n: T): T {
    return new Int(this.value + n.value) as T
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
    return this.modulo(r).isZero()
      ? new Int((this.value * r.a.value) / r.b.value)
      : new Int((this.value * r.a.value) / r.b.value).add(Int.ONE)
  }

  divideFloor(n: PositiveInt): Int {
    return new Int(this.value / n.value)
  }

  divideCeil(n: PositiveInt): Int {
    return this.modulo(n).isZero()
      ? new Int(this.value / n.value)
      : new Int(this.value / n.value).add(Int.ONE)
  }

  modulo(n: Int | Ratio): Int {
    return n instanceof Int
      ? new Int(this.value % n.value)
      : new Int((this.value * n.a.value) % n.b.value)
  }

  isPositive(): this is PositiveInt {
    return this.value > 0
  }

  isEqualTo(n: Int): boolean {
    return this.value === n.value
  }

  isGreaterThan(n: Int): this is PositiveInt {
    return this.value > n.value
  }

  isGreaterThanOrEqualTo<T extends Int>(n: T): this is T {
    return this.value >= n.value
  }

  isLessThan(n: Int): boolean {
    return this.value < n.value
  }

  isLessThanOrEqualTo(n: Int): boolean {
    return this.value <= n.value
  }

  isZero(): boolean {
    return this.isEqualTo(Int.ZERO)
  }

  orLesser(n: Int): Int {
    return n.value < this.value ? n : this
  }

  orGreater(n: Int): Int {
    return n.value > this.value ? n : this
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
  isZero(): false
}

export type NonNegativeNumber = Brand<number, 'NonNegativeNumber'>

export const isNonNegativeNumber = (o: number): o is NonNegativeNumber =>
  Number.isFinite(o) && o >= 0

export class Ratio {
  a: Int
  b: PositiveInt

  constructor(a: Int, b: PositiveInt) {
    this.a = a
    this.b = b
  }

  reciprocal(): Ratio | undefined {
    if (this.a.isPositive()) {
      return new Ratio(this.b, this.a)
    }
  }

  minus(r: Ratio): Ratio {
    const a = this.a.multiply(r.b).subtract(r.a.multiply(this.b))
    const b = this.b.multiply(r.b)
    return new Ratio(a, b)
  }

  isGreaterThan(r: Ratio): this is PositiveRatio {
    return this.a.value * r.b.value > this.b.value * r.a.value
  }

  isGreaterThanOrEqualTo<T extends Ratio>(r: T): this is T {
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

  static fromNumber(n: NonNegativeNumber): Ratio {
    let e = 1
    while (!Number.isInteger(n * e)) {
      e *= 10
    }

    const a = Int.fromNumber(n * e)!
    const b = Int.fromNumber(e)!
    return new Ratio(a, b as PositiveInt)
  }

  toBigNumber(): BigNumber {
    return new BigNumber(this.a.toString()).dividedBy(this.b.toString())
  }

  toString(): string {
    const bn = this.toBigNumber()
    return bn.toFixed(Math.min(bn.decimalPlaces(), 10)) // Limit logs to 10 decimals of precision
  }
}

interface PositiveRatio extends Ratio {
  a: PositiveInt
  b: PositiveInt

  reciprocal(): PositiveRatio
  isEqualTo(r: Ratio): r is PositiveRatio
  isLessThan(r: Ratio): r is PositiveRatio
  isLessThanOrEqualTo(r: Ratio): r is PositiveRatio
  isPositive(): true
}
