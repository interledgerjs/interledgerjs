import { assert } from 'chai'

import loadTests from './helpers/loadTests'

const Parser = require('..')

describe('Parser', function () {
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
      testPackets('ilp_fulfill', Parser.Type.TYPE_ILP_FULFILL)
      testPackets('ilp_prepare', Parser.Type.TYPE_ILP_PREPARE)
      testPackets('ilp_reject', Parser.Type.TYPE_ILP_REJECT)

      function testPackets (typeString: string, type: number) {
        const validTests = loadTests({ type: typeString })
        for (let test of validTests) {
          it('parses ' + typeString + ': ' + test.name, function () {
            const binary = new Buffer(test.binary, 'hex')
            const parsed = Parser.deserializeIlpPacket(binary)
            if (typeString === 'ilp_prepare' || typeString === 'ilp_fulfill' || typeString === 'ilp_reject') {
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
