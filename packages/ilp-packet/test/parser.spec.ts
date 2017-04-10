import { assert } from 'chai'

import loadTests from './helpers/loadTests'

const Parser = require('..')

describe('Parser', function () {
  describe('serializeIlpPayment', function () {
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

  describe('deserializeIlpPayment', function () {
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

  describe('serializeIlqpLiquidityRequest', function () {
    describe('correctly serializes valid ilqp liquidity requests', function () {
      const validTests = loadTests({ type: 'ilqp_liquidity_request' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          const serialized = Parser.serializeIlqpLiquidityRequest(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserializeIlqpLiquidityRequest', function () {
    describe('correctly parses valid ilqp liquidity requests', function () {
      const validTests = loadTests({ type: 'ilqp_liquidity_request' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlqpLiquidityRequest(binary)

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })

  describe('serializeIlqpLiquidityResponse', function () {
    describe('correctly serializes valid ilqp liquidity responses', function () {
      const validTests = loadTests({ type: 'ilqp_liquidity_response' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          json.expiresAt = new Date(json.expiresAt)
          json.liquidityCurve = Buffer.from(json.liquidityCurve, 'hex')

          const serialized = Parser.serializeIlqpLiquidityResponse(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserializeIlqpLiquidityResponse', function () {
    describe('correctly parses valid ilqp liquidity responses', function () {
      const validTests = loadTests({ type: 'ilqp_liquidity_response' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlqpLiquidityResponse(binary)

          parsed.expiresAt = parsed.expiresAt.getTime()
          parsed.liquidityCurve = parsed.liquidityCurve.toString('hex')

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })

  describe('serializeIlqpBySourceRequest', function () {
    describe('correctly serializes valid ilqp by source requests', function () {
      const validTests = loadTests({ type: 'ilqp_by_source_request' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          const serialized = Parser.serializeIlqpBySourceRequest(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserializeIlqpBySourceRequest', function () {
    describe('correctly parses valid ilqp by source requests', function () {
      const validTests = loadTests({ type: 'ilqp_by_source_request' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlqpBySourceRequest(binary)

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })

  describe('serializeIlqpBySourceResponse', function () {
    describe('correctly serializes valid ilqp by source responses', function () {
      const validTests = loadTests({ type: 'ilqp_by_source_response' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          const serialized = Parser.serializeIlqpBySourceResponse(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserializeIlqpBySourceResponse', function () {
    describe('correctly parses valid ilqp by source responses', function () {
      const validTests = loadTests({ type: 'ilqp_by_source_response' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlqpBySourceResponse(binary)

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })

  describe('serializeIlqpByDestinationRequest', function () {
    describe('correctly serializes valid ilqp by destination requests', function () {
      const validTests = loadTests({ type: 'ilqp_by_destination_request' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          const serialized = Parser.serializeIlqpByDestinationRequest(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserializeIlqpByDestinationRequest', function () {
    describe('correctly parses valid ilqp by destination requests', function () {
      const validTests = loadTests({ type: 'ilqp_by_destination_request' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlqpByDestinationRequest(binary)

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })

  describe('serializeIlqpByDestinationResponse', function () {
    describe('correctly serializes valid ilqp by destination responses', function () {
      const validTests = loadTests({ type: 'ilqp_by_destination_response' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          const serialized = Parser.serializeIlqpByDestinationResponse(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserializeIlqpByDestinationResponse', function () {
    describe('correctly parses valid ilqp by destination responses', function () {
      const validTests = loadTests({ type: 'ilqp_by_destination_response' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlqpByDestinationResponse(binary)

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })
})
