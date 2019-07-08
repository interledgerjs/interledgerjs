import { assert } from 'chai'

import loadTests from './helpers/loadTests'

import * as Parser from '@interledger/codecs-ilp'

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
          const binary = Buffer.from(test.binary, 'hex')

          const prepare = Parser.deserializeIlpPrepare(binary)

          const parsed: { [key: string]: string } = {}
          parsed.data = prepare.data.toString('base64')
          parsed.executionCondition = prepare.executionCondition.toString('base64')
          parsed.expiresAt = prepare.expiresAt.toISOString()

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
          const binary = Buffer.from(test.binary, 'hex')

          const fulfill = Parser.deserializeIlpFulfill(binary)

          const parsed: { [key: string]: string } = {}
          parsed.fulfillment = fulfill.fulfillment.toString('base64')
          parsed.data = fulfill.data.toString('base64')

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

  describe('deserializeIlpRejectLOL', function () {
    describe('correctly parses valid ilp reject', function () {
      const validTests = loadTests({ type: 'ilp_reject' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = Buffer.from(test.binary, 'hex')

          const reject = Parser.deserializeIlpRejectLOL(binary)
          const parsed: { [key: string]: string } = {}

          parsed.data = reject.data.toString('base64')

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })

  describe('deserializeIlpPacket', function () {
    describe('correctly parses valid ilp packets', function () {
      function testPackets (typeString: string, type: number) {
        const validTests = loadTests({ type: typeString })
        for (let test of validTests) {
          it('parses ' + typeString + ': ' + test.name, function () {
            const binary = Buffer.from(test.binary, 'hex')
            // TODO
            const packet = Parser.deserializeIlpPacket(binary)
            const data: { [key: string]: string } = {}
            if (typeString === 'ilp_prepare' || typeString === 'ilp_fulfill' || typeString === 'ilp_reject') {
              data.data = packet.data.data.toString('base64')
            }
            if (typeString === 'ilp_prepare') {
              data.expiresAt = (packet.data as Parser.IlpPrepare).expiresAt.toISOString()
              data.executionCondition = (packet.data as Parser.IlpPrepare).executionCondition.toString('base64')
            }
            if (typeString === 'ilp_fulfill') {
              data.fulfillment = (packet.data as Parser.IlpFulfill).fulfillment.toString('base64')
            }
            assert.deepStrictEqual({ type: packet.type, typeString: packet.typeString, data }, { type, typeString, data: test.json })
          })
        }
      }
      testPackets('ilp_fulfill', Parser.Type.TYPE_ILP_FULFILL)
      testPackets('ilp_prepare', Parser.Type.TYPE_ILP_PREPARE)
      testPackets('ilp_reject', Parser.Type.TYPE_ILP_REJECT)
    })
  })
})
