import { assert } from 'chai'

import loadTests from './helpers/loadTests'
import * as Parser from 'ilp-packet'

describe('Parser', function () {
  describe('serializeIlpPrepare', function () {
    describe('correctly serializes valid ilp prepare', function () {
      const validTests = loadTests({ type: 'ilp_prepare' })

      for (const test of validTests) {
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

      for (const test of validTests) {
        it(test.name, function () {
          const binary = Buffer.from(test.binary, 'hex')

          const prepare = Parser.deserializeIlpPrepare(binary)

          const parsed: { [key: string]: string } = {}
          parsed.amount = prepare.amount
          parsed.destination = prepare.destination
          parsed.data = prepare.data.toString('base64')
          parsed.executionCondition = prepare.executionCondition.toString('base64')
          parsed.expiresAt = prepare.expiresAt.toISOString()

          assert.deepEqual(parsed, test.json)
        })
      }
    })

    describe('handles invalid packets', function () {
      it('throws an error on the wrong packet type', function () {
        assert.throws(() => {
          Parser.deserializeIlpPrepare(
            Parser.serializeIlpFulfill({
              fulfillment: Buffer.from('w4ZrSHSczxE7LhXCXSQH+/wUR2/nKWuxvxvNnm5BZlA=', 'base64'),
              data: Buffer.from('Zz/r14ozso4cDbFMmgYlGgX6gx7U7ZHrzRUOcknC5gA=', 'base64'),
            })
          )
        }, 'Packet has incorrect type')
      })

      it('throws an error on an invalid destination address', function () {
        assert.throws(() => {
          Parser.deserializeIlpPrepare(
            Parser.serializeIlpPrepare({
              amount: '107',
              executionCondition: Buffer.from(
                'dOETbcccnl8oO+yDRhy/EmHEAU9y1I+N1lRToLhOfeE=',
                'base64'
              ),
              expiresAt: new Date('2017-12-23T01:21:40.549Z'),
              destination: 'example.alice!',
              data: Buffer.alloc(0),
            })
          )
        }, 'Packet has invalid destination address')
      })
    })
  })

  describe('serializeIlpFulfill', function () {
    describe('correctly serializes valid ilp fulfill', function () {
      const validTests = loadTests({ type: 'ilp_fulfill' })

      for (const test of validTests) {
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

      for (const test of validTests) {
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

      for (const test of validTests) {
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

      for (const test of validTests) {
        it(test.name, function () {
          const binary = Buffer.from(test.binary, 'hex')

          const reject = Parser.deserializeIlpReject(binary)
          const parsed: { [key: string]: string } = {}

          parsed.code = reject.code
          parsed.message = reject.message
          parsed.triggeredBy = reject.triggeredBy
          parsed.data = reject.data.toString('base64')

          assert.deepEqual(parsed, test.json)
        })
      }
    })
  })

  describe('deserializeIlpPacket', function () {
    describe('correctly parses valid ilp packets', function () {
      function testPackets(typeString: string, type: number) {
        const validTests = loadTests({ type: typeString })
        for (const test of validTests) {
          it('parses ' + typeString + ': ' + test.name, function () {
            const binary = Buffer.from(test.binary, 'hex')
            const packet = Parser.deserializeIlpPacket(binary)
            const data: { [key: string]: string } = {}
            if (
              typeString === 'ilp_prepare' ||
              typeString === 'ilp_fulfill' ||
              typeString === 'ilp_reject'
            ) {
              data.data = packet.data.data.toString('base64')
            }
            if (typeString === 'ilp_prepare') {
              data.amount = (packet.data as Parser.IlpPrepare).amount
              data.destination = (packet.data as Parser.IlpPrepare).destination
              data.expiresAt = (packet.data as Parser.IlpPrepare).expiresAt.toISOString()
              data.executionCondition = (packet.data as Parser.IlpPrepare).executionCondition.toString(
                'base64'
              )
            }
            if (typeString === 'ilp_fulfill') {
              data.fulfillment = (packet.data as Parser.IlpFulfill).fulfillment.toString('base64')
            }
            if (typeString === 'ilp_reject') {
              data.code = (packet.data as Parser.IlpReject).code
              data.message = (packet.data as Parser.IlpReject).message
              data.triggeredBy = (packet.data as Parser.IlpReject).triggeredBy
            }
            assert.deepStrictEqual(
              { type: packet.type, typeString: packet.typeString, data },
              { type, typeString, data: test.json }
            )
          })
        }
      }
      testPackets('ilp_fulfill', Parser.Type.TYPE_ILP_FULFILL)
      testPackets('ilp_prepare', Parser.Type.TYPE_ILP_PREPARE)
      testPackets('ilp_reject', Parser.Type.TYPE_ILP_REJECT)
    })
  })

  describe('isValidIlpAddress', function () {
    const validIlpAddresses = [
      'test.alice.XYZ.1234.-_~',
      'g.us-fed.ach.0.acmebank.swx0a0.acmecorp.sales.199.~ipr.cdfa5e16-e759-4ba3-88f6-8b9dc83c1868.2',
      // Valid schemes
      'g.A',
      'private.A',
      'example.A',
      'peer.A',
      'self.A',
      'test.A',
      'test1.A',
      'test2.A',
      'test3.A',
      'local.A',
    ]

    const invalidIlpAddresses = [
      '', // empty
      // Invalid characters.
      'test.alice 123',
      'test.alice!123',
      'test.alice/123',
      'test.alic\xF0',
      // Bad schemes.
      'test', // only a scheme
      'what.alice', // invalid scheme
      'test4.alice', // invalid scheme
      // Invalid separators.
      'test.', // only a prefix
      'test.alice.', // ends in a separator
      '.test.alice', // begins with a separator
      'test..alice', // double separator
    ]

    validIlpAddresses.forEach(function (address) {
      it('validates "' + address + '"', function () {
        assert.strictEqual(Parser.isValidIlpAddress(address), true)
      })
    })

    invalidIlpAddresses.forEach(function (address) {
      it('invalidates "' + address + '"', function () {
        assert.strictEqual(Parser.isValidIlpAddress(address), false)
      })
    })

    it('validates a very-long address', function () {
      let address = 'g.'
      while (address.length < 1023) address += 'x'
      assert.strictEqual(Parser.isValidIlpAddress(address), true)
    })

    it('invalidates a too-long address', function () {
      let address = 'g.'
      while (address.length < 1024) address += 'x'
      assert.strictEqual(Parser.isValidIlpAddress(address), false)
    })
  })
})
