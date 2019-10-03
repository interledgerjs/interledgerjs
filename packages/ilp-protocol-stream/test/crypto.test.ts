import 'mocha'
import * as assert from 'assert'
import * as helpers from '../src/crypto'

if (typeof describe === 'function') {
  describe('crypto helpers (node)', function () {
    runCryptoTests({ describe, it })
  })
}

export function runCryptoTests (args: {describe: Mocha.SuiteFunction, it: Mocha.TestFunction}) {
  const { describe, it } = args

  describe('generateToken', function () {
    it('generates a random 18-byte token', function () {
      assert.equal(helpers.generateToken().length, 18)
    })
  })

  describe('generateSharedSecretFromToken', function () {
    it('generates the expected secret', async function () {
      const seed = Buffer.alloc(32)
      const gotSecret = await helpers.generateSharedSecretFromToken(seed, Buffer.from('foo bar'))
      const wantSecret = Buffer.from('ImTMJmMhjK4VSEyhjCUwlUnatWGB+Pm/UMOrbE6ieWE=', 'base64')
      assert.deepEqual(gotSecret, wantSecret)
    })
  })

  describe('generateRandomCondition', function () {
    it('generates a random 32-byte condition', function () {
      assert.equal(helpers.generateRandomCondition().length, 32)
    })
  })

  describe('generatePskEncryptionKey', function () {
    it('generates the expected key', async function () {
      const secret = Buffer.from('foo')
      const gotKey = await helpers.generatePskEncryptionKey(secret)
      const wantKey = Buffer.from('zfOGMU/uY+EOUCE6tN3WhE77bF/N6pS0wSOmMgEAMEA=', 'base64')
      assert.deepEqual(gotKey, wantKey)
    })
  })

  describe('generateFulfillmentKey', function () {
    it('generates the expected key', async function () {
      const secret = Buffer.from('foo')
      const gotKey = await helpers.generateFulfillmentKey(secret)
      const wantKey = Buffer.from('lh8nGJCJosvfUePaU0uxxXK3jNvV2Y+5ivt1GH1Muhs=', 'base64')
      assert.deepEqual(gotKey, wantKey)
    })
  })

  describe('generateFulfillment', function () {
    it('generates the expected fulfillment', async function () {
      const key = Buffer.alloc(32)
      const gotFulfillment = await helpers.generateFulfillment(key, Buffer.from('foo'))
      const wantFulfillment = Buffer.from('DA2Y9+PZ1F5y6Id7wbEEMn77nAexjy/+ztdtgTB/H/8=', 'base64')
      assert.deepEqual(gotFulfillment, wantFulfillment)
    })
  })

  describe('hash', function () {
    it('generates the expected condition', async function () {
      const fulfillment = Buffer.alloc(32)
      const wantCondition = Buffer.from('Zmh6rfhivXdsj8GLjp+OIAiXFIVu4jOzkCpZHQ1fKSU=', 'base64')
      const gotCondition = await helpers.hash(fulfillment)
      assert.deepEqual(gotCondition, wantCondition)
    })
  })

  describe('decrypt', function () {
    it('decrypts encrypted data', async function () {
      const cleartext = Buffer.from('foo bar')
      const key = await helpers.generatePskEncryptionKey(Buffer.from('secret'))
      const ciphertext = await helpers.encrypt(key, cleartext)
      assert.deepEqual(await helpers.decrypt(key, ciphertext), cleartext)
    })

    it('decrypts known data', async function () {
      const cleartext = Buffer.from('foo bar')
      const key = Buffer.from('AOStyoBvoK9/OFhdmf2TzQRrJsCkxH/cj49Ya7RFOEc=', 'base64')
      const ciphertext = Buffer.from('Y1UiXpDA1GwAv+h95CEv67O49MOAJQrnYEQMrOFsbv6rrlE=', 'base64')
      assert.deepEqual(await helpers.decrypt(key, ciphertext), cleartext)
    })
  })
}
