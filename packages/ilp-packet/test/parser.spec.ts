import { assert } from 'chai'

import loadTests from './helpers/loadTests'

const Parser = require('..')

describe('Parser', function () {
  describe('serialize', function () {
    describe('correctly serializes valid ilp packets', function () {
      const validTests = loadTests({ type: 'ilp_payment' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          const serialized = Parser.serializeIlpPayment(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserialize', function () {
    describe('correctly parses valid ilp packets', function () {
      const validTests = loadTests({ type: 'ilp_payment' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlpPayment(binary)

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })
})
