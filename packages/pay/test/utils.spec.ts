/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from '@jest/globals'
import { AccountUrl, Int, Ratio, PositiveInt } from '../src'
import Long from 'long'

describe('account urls', () => {
  it('AccountUrl#fromPaymentPointer', () => {
    expect(AccountUrl.fromPaymentPointer('example.com')).toBeUndefined()
    expect(AccountUrl.fromPaymentPointer('$user:pass@example.com')).toBeUndefined()
    expect(AccountUrl.fromPaymentPointer('$localhost:3000')).toBeUndefined()
    expect(AccountUrl.fromPaymentPointer('$example.com?foo=bar')).toBeUndefined()
    expect(AccountUrl.fromPaymentPointer('$example.com#hash')).toBeUndefined()

    expect(AccountUrl.fromPaymentPointer('$example.com/alice')!.toString()).toBe(
      'https://example.com/alice'
    )
  })

  it('AccountUrl#fromUrl', () => {
    expect(AccountUrl.fromUrl('http://wallet.example')).toBeUndefined()
    expect(AccountUrl.fromUrl('https://user:pass@wallet.example')).toBeUndefined()
    expect(AccountUrl.fromUrl('https://wallet.example:8080/')).toBeUndefined()

    expect(AccountUrl.fromUrl('https://wallet.example/account?foo=bar')!.toString()).toBe(
      'https://wallet.example/account'
    )
  })

  it('AccountUrl#toEndpointUrl', () => {
    expect(AccountUrl.fromPaymentPointer('$cool.wallet.co')!.toEndpointUrl()).toBe(
      'https://cool.wallet.co/.well-known/pay'
    )
    expect(AccountUrl.fromUrl('https://user.example?someId=123')!.toEndpointUrl()).toBe(
      'https://user.example/.well-known/pay?someId=123'
    )
    expect(AccountUrl.fromUrl('https://user.example')!.toEndpointUrl()).toBe(
      'https://user.example/.well-known/pay'
    )
  })

  it('AccountUrl#toString', () => {
    expect(AccountUrl.fromPaymentPointer('$wallet.example')!.toString()).toBe(
      'https://wallet.example/.well-known/pay'
    )
    expect(AccountUrl.fromUrl('https://wallet.example/user/account/?baz#bleh')!.toString()).toBe(
      'https://wallet.example/user/account'
    )
  })

  it('AccountUrl#toPaymentPointer', () => {
    expect(AccountUrl.fromUrl('https://somewebsite.co/')!.toPaymentPointer()).toBe(
      '$somewebsite.co'
    )
    expect(AccountUrl.fromUrl('https://user.example?someId=123')!.toPaymentPointer()).toBe(
      '$user.example'
    )
    expect(AccountUrl.fromUrl('https://example.com/bob/#hash')!.toPaymentPointer()).toBe(
      '$example.com/bob'
    )

    expect(AccountUrl.fromPaymentPointer('$example.com/')!.toPaymentPointer()).toBe('$example.com')
    expect(AccountUrl.fromPaymentPointer('$example.com/charlie/')!.toPaymentPointer()).toBe(
      '$example.com/charlie'
    )
    expect(AccountUrl.fromPaymentPointer('$example.com/charlie')!.toPaymentPointer()).toBe(
      '$example.com/charlie'
    )
  })
})

describe('integer operations', () => {
  it('Int#from', () => {
    expect(Int.from(Int.ONE)).toEqual(Int.ONE)
    expect(Int.from(Int.MAX_U64)).toEqual(Int.MAX_U64)

    expect(Int.from('1000000000000000000000000000000000000')?.value).toBe(
      BigInt('1000000000000000000000000000000000000')
    )
    expect(Int.from('1')?.value).toBe(BigInt(1))
    expect(Int.from('0')?.value).toBe(BigInt(0))
    expect(Int.from('-2')).toBeUndefined()
    expect(Int.from('2.14')).toBeUndefined()

    expect(Int.from(Long.UZERO)).toEqual(Int.ZERO)
    expect(Int.from(Long.UONE)).toEqual(Int.ONE)
    expect(Int.from(Long.MAX_UNSIGNED_VALUE)).toEqual(Int.MAX_U64)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(Int.from({} as any)).toBeUndefined()
  })

  it('Int#modulo', () => {
    expect(Int.from(5)!.modulo(Int.from(3) as PositiveInt)).toEqual(Int.TWO)
    expect(Int.from(45)!.modulo(Int.from(45) as PositiveInt)).toEqual(Int.ZERO)
  })

  it('Int#toLong', () => {
    expect(Int.from(1234)!.toLong()).toEqual(Long.fromNumber(1234, true))
    expect(Int.MAX_U64.toLong()).toEqual(Long.MAX_UNSIGNED_VALUE)
    expect(Int.MAX_U64.add(Int.ONE).toLong()).toBeUndefined()
  })

  it('Int#toRatio', () => {
    expect(Int.ONE.toRatio()).toEqual(Ratio.of(Int.ONE, Int.ONE))
    expect(Int.MAX_U64.toRatio()).toEqual(Ratio.of(Int.MAX_U64, Int.ONE))
  })

  it('Ratio#from', () => {
    expect(Ratio.from(2)).toEqual(Ratio.of(Int.TWO, Int.ONE))
    expect(Ratio.from(12.34)).toEqual(Ratio.of(Int.from(1234)!, Int.from(100) as PositiveInt))
    expect(Ratio.from(0)).toEqual(Ratio.of(Int.ZERO, Int.ONE))
    expect(Ratio.from(NaN)).toBeUndefined()
    expect(Ratio.from(Infinity)).toBeUndefined()
  })

  it('Ratio#floor', () => {
    expect(Ratio.from(2.999)!.floor()).toEqual(Int.TWO)
    expect(Ratio.from(0)!.floor()).toEqual(Int.ZERO)
    expect(Ratio.from(100.1)!.floor()).toEqual(Int.from(100)!)
  })

  it('Ratio#reciprocal', () => {
    expect(Ratio.of(Int.ONE, Int.TWO).reciprocal()).toEqual(Ratio.of(Int.TWO, Int.ONE))
    expect(Ratio.of(Int.TWO, Int.ONE).reciprocal()).toEqual(Ratio.of(Int.ONE, Int.TWO))
    expect(Ratio.of(Int.ZERO, Int.ONE).reciprocal()).toBeUndefined()
  })

  it('Ratio#isEqualTo', () => {
    expect(Ratio.of(Int.from(8)!, Int.TWO).isEqualTo(Ratio.of(Int.from(4)!, Int.ONE))).toBe(true)
    expect(Ratio.of(Int.from(0)!, Int.TWO).isEqualTo(Ratio.of(Int.from(4)!, Int.ONE))).toBe(false)
  })

  it('Ratio#toString', () => {
    expect(Ratio.of(Int.from(4)!, Int.ONE).toString()).toBe('4')
    expect(Ratio.of(Int.ONE, Int.TWO).toString()).toBe('0.5')
    expect(Ratio.of(Int.ONE, Int.from(3) as PositiveInt).toString()).toBe((1 / 3).toString())
  })
})
