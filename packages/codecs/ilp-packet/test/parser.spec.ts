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

          json.data = Buffer.from(json.data, 'base64')

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

          parsed.data = parsed.data.toString('base64')

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })
  describe('serializeIlpForwardedPayment', function () {
    describe('correctly serializes valid ilp packets', function () {
      const validTests = loadTests({ type: 'ilp_forwarded_payment' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          json.data = Buffer.from(json.data, 'base64')

          const serialized = Parser.serializeIlpForwardedPayment(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserializeIlpForwardedPayment', function () {
    describe('correctly parses valid ilp packets', function () {
      const validTests = loadTests({ type: 'ilp_forwarded_payment' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlpForwardedPayment(binary)

          parsed.data = parsed.data.toString('base64')

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

  describe('serializeIlpError', function () {
    describe('correctly serializes valid ilp errors', function () {
      const validTests = loadTests({ type: 'ilp_error' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          json.triggeredAt = new Date(json.triggeredAt)

          const serialized = Parser.serializeIlpError(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserializeIlpError', function () {
    describe('correctly parses valid ilp errors', function () {
      const validTests = loadTests({ type: 'ilp_error' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlpError(binary)

          parsed.triggeredAt = parsed.triggeredAt.getTime()

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })

  describe('serializeIlpFulfillment', function () {
    describe('correctly serializes valid ilp fulfillments', function () {
      const validTests = loadTests({ type: 'ilp_fulfillment' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          json.data = Buffer.from(json.data, 'base64')

          const serialized = Parser.serializeIlpFulfillment(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserializeIlpFulfillment', function () {
    describe('correctly parses valid ilp fulfillments', function () {
      const validTests = loadTests({ type: 'ilp_fulfillment' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlpFulfillment(binary)

          parsed.data = parsed.data.toString('base64')

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })

  describe('serializeIlpRejection', function () {
    describe('correctly serializes valid ilp rejections', function () {
      const validTests = loadTests({ type: 'ilp_rejection' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          json.data = Buffer.from(json.data, 'base64')

          const serialized = Parser.serializeIlpRejection(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserializeIlpRejection', function () {
    describe('correctly parses valid ilp rejections', function () {
      const validTests = loadTests({ type: 'ilp_rejection' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlpRejection(binary)

          parsed.data = parsed.data.toString('base64')

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })

  describe('serializeIlpPrepare', function () {
    describe('correctly serializes valid ilp prepare', function () {
      const validTests = loadTests({ type: 'ilp_prepare' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          json.data = Buffer.from(json.data, 'base64')
          json.executionCondition = Buffer.from(json.executionCondition, 'base64')
          json.expiresAt = new Date(json.expiresAt)

          const serialized = Parser.serializeIlpPrepare(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserializeIlpPrepare', function () {
    describe('correctly parses valid ilp prepare', function () {
      const validTests = loadTests({ type: 'ilp_prepare' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlpPrepare(binary)

          parsed.data = parsed.data.toString('base64')
          parsed.executionCondition = parsed.executionCondition.toString('base64')
          parsed.expiresAt = parsed.expiresAt.toISOString()

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })

  describe('serializeIlpFulfill', function () {
    describe('correctly serializes valid ilp fulfill', function () {
      const validTests = loadTests({ type: 'ilp_fulfill' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          json.data = Buffer.from(json.data, 'base64')
          json.fulfillment = Buffer.from(json.fulfillment, 'base64')

          const serialized = Parser.serializeIlpFulfill(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserializeIlpFulfill', function () {
    describe('correctly parses valid ilp fulfill', function () {
      const validTests = loadTests({ type: 'ilp_fulfill' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlpFulfill(binary)

          parsed.fulfillment = parsed.fulfillment.toString('base64')
          parsed.data = parsed.data.toString('base64')

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })

  describe('serializeIlpReject', function () {
    describe('correctly serializes valid ilp reject', function () {
      const validTests = loadTests({ type: 'ilp_reject' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          json.data = Buffer.from(json.data, 'base64')

          const serialized = Parser.serializeIlpReject(json)

          assert.deepEqual(serialized.toString('hex'), test.binary)
        })
      }
    })
  })

  describe('deserializeIlpReject', function () {
    describe('correctly parses valid ilp reject', function () {
      const validTests = loadTests({ type: 'ilp_reject' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'hex')

          const parsed = Parser.deserializeIlpReject(binary)

          parsed.data = parsed.data.toString('base64')

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })

  describe('deserializeIlpPacket', function () {
    describe('correctly parses valid ilp packets', function () {
      testPackets('ilp_payment', Parser.Type.TYPE_ILP_PAYMENT)
      testPackets('ilqp_liquidity_request', Parser.Type.TYPE_ILQP_LIQUIDITY_REQUEST)
      testPackets('ilqp_liquidity_response', Parser.Type.TYPE_ILQP_LIQUIDITY_RESPONSE)
      testPackets('ilqp_by_source_request', Parser.Type.TYPE_ILQP_BY_SOURCE_REQUEST)
      testPackets('ilqp_by_source_response', Parser.Type.TYPE_ILQP_BY_SOURCE_RESPONSE)
      testPackets('ilqp_by_destination_request', Parser.Type.TYPE_ILQP_BY_DESTINATION_REQUEST)
      testPackets('ilqp_by_destination_response', Parser.Type.TYPE_ILQP_BY_DESTINATION_RESPONSE)
      testPackets('ilp_error', Parser.Type.TYPE_ILP_ERROR)
      testPackets('ilp_fulfillment', Parser.Type.TYPE_ILP_FULFILLMENT)
      testPackets('ilp_forwarded_payment', Parser.Type.TYPE_ILP_FORWARDED_PAYMENT)
      testPackets('ilp_rejection', Parser.Type.TYPE_ILP_REJECTION)
      testPackets('ilp_fulfill', Parser.Type.TYPE_ILP_FULFILL)
      testPackets('ilp_prepare', Parser.Type.TYPE_ILP_PREPARE)
      testPackets('ilp_reject', Parser.Type.TYPE_ILP_REJECT)

      function testPackets (typeString: string, type: number) {
        const validTests = loadTests({ type: typeString })
        for (let test of validTests) {
          it('parses ' + typeString + ': ' + test.name, function () {
            const binary = new Buffer(test.binary, 'hex')
            const parsed = Parser.deserializeIlpPacket(binary)
            if (typeString === 'ilqp_liquidity_response') {
              parsed.data.expiresAt = parsed.data.expiresAt.getTime()
              parsed.data.liquidityCurve = parsed.data.liquidityCurve.toString('hex')
            }
            if (typeString === 'ilp_error') {
              parsed.data.triggeredAt = parsed.data.triggeredAt.getTime()
            }
            if (typeString === 'ilp_payment' || typeString === 'ilp_forwarded_payment' || typeString === 'ilp_fulfillment' || typeString === 'ilp_rejection' || typeString === 'ilp_prepare' || typeString === 'ilp_fulfill' || typeString === 'ilp_reject') {
              parsed.data.data = parsed.data.data.toString('base64')
            }
            if (typeString === 'ilp_prepare') {
              parsed.data.expiresAt = parsed.data.expiresAt.toISOString()
              parsed.data.executionCondition = parsed.data.executionCondition.toString('base64')
            }
            if (typeString === 'ilp_fulfill') {
              parsed.data.fulfillment = parsed.data.fulfillment.toString('base64')
            }
            assert.deepEqual(parsed, { type, typeString, data: test.json })
          })
        }
      }
    })
  })
})
