/* eslint-disable @typescript-eslint/no-non-null-assertion */
import Long from 'long'

/**
 * Promise that can be resolved or rejected outside its executor callback.
 * Also enables a synchronously getting the resolved value of the Promise
 */
export class PromiseResolver<T> {
  private isSettled = false
  value?: T
  resolve!: (value: T) => void
  reject!: () => void
  readonly promise = new Promise<T>((resolve, reject) => {
    this.resolve = (value: T) => {
      if (!this.isSettled) {
        this.isSettled = true
        this.value = value
        resolve(value)
      }
    }
    this.reject = () => {
      this.isSettled = true
      reject()
    }
  })
}

/**
 * Return a rejected Promise if the given Promise does not resolve within the timeout,
 * or return the resolved value of the Promise
 */
export const timeout = <T>(duration: number, promise: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout
  return Promise.race([
    new Promise<T>((_, reject) => {
      timer = setTimeout(reject, duration)
    }),
    promise.finally(() => clearTimeout(timer)),
  ])
}

/** Wait and resolve after the given number of milliseconds */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Integer greater than or equal to 0 */
export class Int {
  readonly value: bigint // TODO Is there a way to prevent consumers from setting this?

  static ZERO = new Int(0n)
  static ONE = new Int(1n) as PositiveInt
  static TWO = new Int(2n) as PositiveInt
  static MAX_U64 = new Int(18446744073709551615n) as PositiveInt

  private constructor(n: bigint) {
    this.value = n
  }

  static from<T extends Int>(n: T): T
  static from(n: Long): Int
  static from(n: NonNegativeInteger): Int
  static from(n: number): Int | undefined
  static from(n: bigint): Int | undefined
  static from(n: string): Int | undefined
  static from(n: Int | bigint | number | string): Int | undefined // Necessary for amounts passed during setup
  static from<T extends Long | Int | bigint | number | string>(n: T): Int | undefined {
    if (n instanceof Int) {
      return n
    } else if (typeof n === 'bigint') {
      return Int.fromBigint(n)
    } else if (typeof n === 'string') {
      return Int.fromString(n)
    } else if (typeof n === 'number') {
      return Int.fromNumber(n)
    } else if (Long.isLong(n)) {
      return Int.fromLong(n)
    }
  }

  private static fromBigint(n: bigint): Int | undefined {
    if (n >= 0) {
      return new Int(n)
    }
  }

  private static fromString(n: string): Int | undefined {
    try {
      return Int.fromBigint(BigInt(n))
      // eslint-disable-next-line no-empty
    } catch (_) {}
  }

  private static fromNumber(n: NonNegativeInteger): Int
  private static fromNumber(n: number): Int | undefined
  private static fromNumber<T extends number>(n: T): Int | undefined {
    if (isNonNegativeInteger(n)) {
      return new Int(BigInt(n))
    }
  }

  private static fromLong(n: Long): Int {
    const lsb = BigInt(n.getLowBitsUnsigned())
    const gsb = BigInt(n.getHighBitsUnsigned())
    return new Int(lsb + 4294967296n * gsb)
  }

  add(n: PositiveInt): PositiveInt
  add(n: Int): Int
  add<T extends Int>(n: T): Int {
    return new Int(this.value + n.value)
  }

  // TODO This is saturating. Should it be? How should this be handled? Use two separate methods?
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
    return this.multiply(r.a).divideCeil(r.b)
  }

  divide(d: PositiveInt): Int {
    return new Int(this.value / d.value)
  }

  divideCeil(d: PositiveInt): Int {
    // Simple algorithm with no modulo/conditional: https://medium.com/@arunistime/how-div-round-up-works-179f1a2113b5
    return new Int((this.value + d.value - 1n) / d.value)
  }

  modulo(n: PositiveInt): Int {
    return new Int(this.value % n.value)
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
    return this.value > 0
  }

  orLesser(n?: Int): Int {
    return !n ? this : this.value <= n.value ? this : n
  }

  orGreater(n: PositiveInt): PositiveInt
  orGreater(n?: Int): Int
  orGreater<T extends Int>(n: T): Int {
    return !n ? this : this.value >= n.value ? this : n
  }

  toString(): string {
    return this.value.toString()
  }

  toLong(): Long {
    const lsb = BigInt.asIntN(32, this.value)
    const gsb = (this.value - lsb) / 4294967296n
    return new Long(Number(lsb), Number(gsb), true)
  }

  valueOf(): number {
    return Number(this.value)
  }

  toRatio(): Ratio {
    return new Ratio(this, Int.ONE)
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
  orLesser(n?: PositiveInt): PositiveInt
  orLesser(n: Int): Int
  orGreater(n?: Int): PositiveInt
  toRatio(): PositiveRatio
}

declare class Tag<N extends string> {
  protected __nominal: N
}

export type Brand<T, N extends string> = T & Tag<N>

/** Finite number greater than or equal to 0 */
export type NonNegativeRational = Brand<number, 'NonNegativeRational'>

/** Is the given number greater than or equal to 0, not `NaN`, and not `Infinity`? */
export const isNonNegativeRational = (o: unknown): o is NonNegativeRational =>
  typeof o === 'number' && Number.isFinite(o) && o >= 0

/** Integer greater than or equal to 0 */
export type NonNegativeInteger = Brand<number, 'NonNegativeInteger'>

/** Is the given number an integer (not `NaN` nor `Infinity`) and greater than or equal to 0? */
export const isNonNegativeInteger = (o: number): o is NonNegativeInteger =>
  Number.isInteger(o) && o >= 0

/**
 * Ratio of two integers: a numerator greater than or equal to 0,
 * and a denominator greater than 0
 */
export class Ratio {
  /** Numerator */
  readonly a: Int
  /** Denominator */
  readonly b: PositiveInt

  constructor(a: Int, b: PositiveInt) {
    this.a = a
    this.b = b
  }

  static from(n: NonNegativeRational): Ratio
  static from(n: number): Ratio | undefined {
    if (!isNonNegativeRational(n)) {
      return
    }

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

  floor(): Int {
    return this.a.divide(this.b)
  }

  ceil(): Int {
    return this.a.divideCeil(this.b)
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

  valueOf(): number {
    return +this.a / +this.b
  }

  toString(): string {
    return this.valueOf().toString()
  }
}

/** Ratio of two integers greater than 0 */
export interface PositiveRatio extends Ratio {
  a: PositiveInt
  b: PositiveInt

  reciprocal(): PositiveRatio
  ceil(): PositiveInt
  isLessThan(r: Ratio): r is PositiveRatio
  isLessThanOrEqualTo(r: Ratio): r is PositiveRatio
  isPositive(): true
}
