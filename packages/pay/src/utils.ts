/* eslint-disable @typescript-eslint/no-non-null-assertion */
import BigNumber from 'bignumber.js'
import Long from 'long'
import { hash } from 'ilp-protocol-stream/dist/src/crypto'
import createLogger, { Logger } from 'ilp-logger'

/** Promise that can be resolved or rejected outside its executor callback */
export class PromiseResolver<T> {
  resolve!: (value?: T | PromiseLike<T>) => void
  reject!: (value?: T | PromiseLike<T>) => void
  readonly promise = new Promise<T>((resolve, reject) => {
    this.resolve = resolve
    this.reject = reject
  })
}

// TODO Add this
export const timeout = <T>(duration: number, promise: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout
  return Promise.race([
    new Promise<T>((_, reject) => {
      timer = setTimeout(reject, duration)
    }),
    promise.finally(() => clearTimeout(timer)),
  ])
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

export const getConnectionLogger = async (destinationAddress: string): Promise<Logger> => {
  const connectionId = await hash(Buffer.from(destinationAddress))
  return createLogger(`ilp-pay:${connectionId.toString('hex').slice(0, 6)}`)
}

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

  static from<T extends Int>(n: T): T
  static from(n: Long): Int
  static from(n: number): Int | undefined
  static from(n: string): Int | undefined
  static from(n: BigNumber): Int | undefined
  static from(n: Int | Long | number | string | BigNumber): Int | undefined {
    if (n instanceof Int) {
      return n
    } else if (typeof n === 'string') {
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

  // TODO Use valueOf instead?
  toNumber(): number {
    return Number(this.value)
  }
}

/** Integer greater than 0 */
export interface PositiveInt extends Int {
  add(n: Int): PositiveInt
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

declare class Tag<N extends string> {
  protected __nominal: N
}

export type Brand<T, N extends string> = T & Tag<N>

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

  static from(n: NonNegativeNumber): Ratio {
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

  multiply(r: Ratio): Ratio {
    const a = this.a.multiply(r.a)
    const b = this.b.multiply(r.b)
    return new Ratio(a, b)
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
export interface PositiveRatio extends Ratio {
  a: PositiveInt
  b: PositiveInt

  reciprocal(): PositiveRatio
  isLessThan(r: Ratio): r is PositiveRatio
  isLessThanOrEqualTo(r: Ratio): r is PositiveRatio
  isPositive(): true
}
