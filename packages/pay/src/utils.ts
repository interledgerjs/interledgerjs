import BigNumber from 'bignumber.js'
import Long from 'long'
import uuid from 'uuid/v4'
import { Maybe } from 'true-myth'
import { Matcher } from 'true-myth/maybe'

export const getConnectionId = (destinationAddress: string) =>
  (destinationAddress.split('.').slice(-1)[0] || uuid()).replace(/[-_]/g, '').slice(0, 6)

export const timeout = <T>(durationMs: number, task: Promise<T>, timeoutValue?: T) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(timeoutValue), durationMs)
    task.then(resolve, reject).finally(() => clearTimeout(timer))
  })

// TODO Change these to higher order functions: e.g., divide = a => b => a.dividedBy(b)
//      Then use Maybe.ap ?

// TODO More performant
export const toBigNumber = (num: Long) => new BigNumber(num.toString())

// TODO More performant
export const toLong = (num: BigNumber) =>
  Long.fromString(num.toFixed(0, BigNumber.ROUND_DOWN), true)

// export type Rational = Brand<BigNumber, 'Rational'>
// export type Integer = Brand<Rational, 'Integer'>

/** Is the given amount a BigNumber, finite, and non-negative (positive or 0)? */
export const isRational = (n: BigNumber): n is Rational =>
  n.isGreaterThanOrEqualTo(0) && n.isFinite()

export const isInteger = (n: BigNumber): n is Integer => isRational(n) && n.isInteger()

export const stringify: Matcher<BigNumber, string> = {
  Just: n => n.toString(),
  Nothing: () => 'N/A'
}

// (o: Maybe<BigNumber>): string => o.map(n => n.toString()).unwrapOr('N/A')

/** Safe division. If dividing by 0, return `Nothing`. */
// export const divide = (a: Rational) => (b: Rational): Maybe<Rational> =>
//   b.isZero() ? Maybe.nothing() : Maybe.just(a.dividedBy(b) as Rational)
export const divide = (a: Rational) => (b: Rational): Maybe<Rational> =>
  b.isZero() ? Maybe.nothing() : Maybe.just(a.dividedBy(b) as Rational)

export const ceil = (n: Rational) => n.integerValue(BigNumber.ROUND_CEIL) as Integer

export const floor = (n: Rational) => n.integerValue(BigNumber.ROUND_DOWN) as Integer

/** Safe modulo operation. If dividing by 0, return `Nothing`. */
export const modulo = (a: Integer) => (b: Integer): Maybe<Integer> =>
  b.isZero() ? Maybe.nothing() : Maybe.just(a.modulo(b) as Integer)

// export const add = (a: Rational) => (b: Rational) => a.plus(b) as Rational
export const add = (a: Integer) => (b: Integer) => a.plus(b) as Integer
export const add1 = (n: Integer) => n.plus(1) as Integer

/** Subtract b from a. If difference is less than 0, `Nothing`. */
export const subtract = <T extends Rational>(a: T) => (b: T): Maybe<T> =>
  b.isGreaterThan(a) ? Maybe.nothing() : Maybe.just(a.minus(b) as T)

export const multiply = (a: Rational) => (b: Rational) => a.times(b) as Rational
export const multiplyInt = (a: Integer) => (b: Integer) => a.times(b) as Integer

export const max = <T extends Rational>(amounts: T[]): Maybe<T> =>
  amounts.length === 0 ? Maybe.nothing() : Maybe.just(BigNumber.max(...amounts) as T)

/** Maximum of all given `Just` values, or `Nothing` if no values are `Just`. */
export const maybeMax = (...amounts: Maybe<Integer>[]): Maybe<Integer> =>
  amounts.length === 0
    ? Maybe.nothing()
    : Maybe.all(...amounts.filter(Maybe.isJust)).map(
        justAmounts => BigNumber.max(...justAmounts) as Integer
      )

/** Minimum of all the given `Just` values, or `Nothing` if no values are `Just`. */
export const maybeMin = (...amounts: Maybe<Integer>[]): Maybe<Integer> =>
  amounts.length === 0
    ? Maybe.nothing()
    : Maybe.all(...amounts.filter(Maybe.isJust)).map(
        justAmounts => BigNumber.min(...justAmounts) as Integer
      )

export const min = <T extends Rational>(amounts: T[]): Maybe<T> =>
  amounts.length === 0 ? Maybe.nothing() : Maybe.just(BigNumber.min(...amounts) as T)

export const equals = (a: BigNumber) => (b: BigNumber): boolean => a.isEqualTo(b)

export const greaterThan = (a: BigNumber) => (b: BigNumber): boolean => a.isGreaterThan(b)

export const lessThan = (a: BigNumber) => (b: BigNumber): boolean => a.isLessThan(b)

export const SAFE_ZERO = new BigNumber(0) as Integer

/** TODO Move these "safety" utils somewhere else? */

/** Nominal type to enforce usage of custom type guards */
// export type Brand<K, T> = K & { readonly __brand: T }

// TODO Try this to see if it improves the type checking vs aliases

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
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const spread = <T extends (...args: any[]) => any>(f: T) => (
  args: Parameters<T>
): ReturnType<T> => f(...args)
