// TODO Remove after I get BigInt working with eslint...!
/* eslint-disable no-undef*/
import BigNumber from 'bignumber.js'
import Long from 'long'
import { Errors, IlpReject, serializeIlpReject } from 'ilp-packet'
import { IlpAddress } from './setup/shared'

export const getConnectionId = (destinationAddress: IlpAddress) =>
  destinationAddress.split('.').slice(-1)[0].replace(/[-_]/g, '').slice(0, 6)

/** TODO */
const DEFAULT_PACKET_TIMEOUT_MS = 30000

/** TODO */
export const getDefaultExpiry: (destination: string) => Date = () =>
  new Date(Date.now() + DEFAULT_PACKET_TIMEOUT_MS)

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
export const F99_REJECT = serializeIlpReject(createReject(Errors.codes.F99_APPLICATION_ERROR))

/** unexpected payment error */
export const F06_REJECT = serializeIlpReject(createReject(Errors.codes.F06_UNEXPECTED_PAYMENT))

export const timeout = <T>(durationMs: number, task: Promise<T>, timeoutValue?: T) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(timeoutValue), durationMs)
    task.then(resolve, reject).finally(() => clearTimeout(timer))
  })

// TODO More performant
export const toBigNumber = (num: Long) => new BigNumber(num.toString())

// TODO More performant
export const toLong = (num: BigNumber) =>
  Long.fromString(num.toFixed(0, BigNumber.ROUND_DOWN), true)

/** Is the given amount a BigNumber, finite, and non-negative (positive or 0)? */
export const isRational = (n: BigNumber): n is Rational =>
  n.isGreaterThanOrEqualTo(0) && n.isFinite()

export const isInteger = (n: BigNumber): n is Integer => isRational(n) && n.isInteger()

export const SAFE_ZERO = new BigNumber(0) as Integer

/** Nominal type to enforce usage of custom type guards */
// export type Brand<K, T> = K & { readonly __brand: T }
// export type Rational = Brand<BigNumber, 'Rational'>
// export type Integer = Brand<Rational, 'Integer'>

export class Rational extends BigNumber {
  protected __isRational: undefined
}

export class Integer extends Rational {
  protected __isInteger: undefined
}

declare class Tag<N extends string> {
  protected __nominal: N
}
export type Brand<T, N extends string> = T & Tag<N>

// TODO Do I need these UInt64 utils?

// export type UInt64BigNumber = Brand<BigNumber, 'UInt64BigNumber'>

export const MAX_UINT64 = new BigNumber('18446744073709551615') as Integer

// export const isUInt64 = (o: BigNumber): o is UInt64BigNumber =>
//   isSafeBigNumber(o) && o.isInteger() && o.isLessThanOrEqualTo(MAX_UINT64)

/** Wait and resolve after the given number of milliseconds */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// export class Int {
//   value: bigint

//   constructor(n: bigint) {
//     if (n < 0) {
//       // TODO How should this work?
//       throw new Error('Cannot use negative numbers')
//     }

//     // TODO Check against NaN? BigInt throws if it's NaN

//     this.value = n // TODO
//   }

//   static from(o: BigNumber | string | number | Long): Int {
//     if (BigNumber.isBigNumber(o)) {
//       return new Int(BigInt(o.toFixed())) // TODO This MUST be rounded first!
//     } else if (typeof o === 'string' || typeof o === 'number') {
//       return new Int(BigInt(o))
//     } else {
//       return o.lessThanOrEqual(Number.MAX_SAFE_INTEGER)
//         ? new Int(BigInt(o.toNumber()))
//         : new Int(BigInt(o.toString()))
//     }
//   }

//   add(n: Int): Int {
//     return new Int(this.value + n.value)
//   }

//   // TODO Require predicate -> SafeSubtraction?

//   subtract(n: Int): Int | undefined {
//     if (this.value >= n.value) {
//       return new Int(this.value - n.value)
//     }
//   }

//   multiply(n: Int): Int {
//     return new Int(this.value * n.value)
//   }

//   multiplyFloor(n: Ratio): Int | undefined {
//     return this.divideFloor(n.reciprocal())
//   }

//   multiplyCeil(n: Ratio): Int | undefined {
//     return this.divideCeil(n.reciprocal())
//   }

//   divideCeil(n: Int | Ratio): Int | undefined {
//     const a = n instanceof Int ? this.value : this.value * n.b.value
//     const b = n instanceof Int ? n.value : n.a.value
//     if (b > BigInt(0)) {
//       return new Int(a % b === BigInt(0) ? a / b : a / b + BigInt(1))
//     }
//   }

//   divideFloor(n: Int | Ratio): Int | undefined {
//     const a = n instanceof Int ? this.value : this.value * n.b.value
//     const b = n instanceof Int ? n.value : n.a.value
//     if (b > BigInt(0)) {
//       return new Int(a / b)
//     }
//   }

//   // isPositive(): PositiveInt {
//   //   // TODO Type signature for positive int?
//   // }

//   isEqualTo(n: Int): boolean {
//     return this.value === n.value
//   }

//   isGreaterThan(n: Int): boolean {
//     return this.value > n.value
//   }

//   isGreaterThanOrEqualTo(n: Int): boolean {
//     return this.value >= n.value
//   }

//   isLessThan(n: Int): boolean {
//     return this.value < n.value
//   }

//   isLessThanOrEqualTo(n: Int): boolean {
//     return this.value <= n.value
//   }

//   isZero(): boolean {
//     return this.value === 0n
//   }

//   orLessor(n?: Int): Int {
//     return !n || this.value <= n.value ? this : n
//   }

//   orGreater(n?: Int): Int {
//     return !n || this.value >= n.value ? this : n
//   }

//   filter(pred: (n: this) => boolean): Int | undefined {
//     if (pred(this)) {
//       return this
//     }
//   }

//   toString() {
//     return this.value.toString()
//   }

//   toLong(): Long {
//     // TODO How to make this more performant?
//     return Long.fromString(this.value.toString())
//   }
// }

// export class Ratio {
//   a: Int
//   b: Int

//   constructor(a: Int, b: Int) {
//     this.a = a

//     // TODO Should this validate that b isn't 0? b can't be 0, right, or it's an invalid ratio?

//     this.b = b
//   }

//   reciprocal(): Ratio {
//     return new Ratio(this.b, this.a)
//   }

//   isEqualTo(n: Ratio): boolean {
//     return this.a.value * n.b.value === this.b.value * n.a.value
//   }

//   isGreaterThan(n: Ratio): boolean {
//     return this.a.value * n.b.value > this.b.value * n.a.value
//   }

//   isGreaterThanOrEqualTo(n: Ratio): boolean {
//     return this.a.value * n.b.value >= this.b.value * n.a.value
//   }

//   isLessThan(n: Ratio): boolean {
//     return this.a.value * n.b.value < this.b.value * n.a.value
//   }

//   isLessThanOrEqualTo(n: Ratio): boolean {
//     return this.a.value * n.b.value <= this.b.value * n.a.value
//   }

//   isZero(): boolean {
//     return this.a.isZero()
//   }

//   // TODO fromNumber ?
// }
