import * as Tag from '..'
import { randomBytes } from 'crypto'
import { expect } from 'chai'

describe('encode & decode', () => {
  it('should decode an encoded tag', () => {
    const key = randomBytes(32)
    const encoded = Tag.encode(key, '{"foo":"bar"}')
    const decoded = Tag.decode(key, encoded)
    expect(decoded).equals('{"foo":"bar"}')
  })
})
