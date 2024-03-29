import * as CCP from '../src'
import { assert } from 'chai'
import { useFakeTimers } from 'sinon'
import { IlpPrepare, isFulfill } from 'ilp-packet'

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

describe('CCP', function () {
  beforeEach(function () {
    this.clock = useFakeTimers(START_DATE)
  })

  afterEach(function () {
    this.clock.restore()
  })

  describe('Route Control Request', function () {
    describe('payload', function () {
      const routeControlRequest: CCP.CcpRouteControlRequest = {
        mode: CCP.Mode.MODE_SYNC,
        lastKnownRoutingTableId: '70d1a134-a0df-4f47-964f-6e19e2ab3790',
        lastKnownEpoch: 32,
        features: ['foo', 'bar'],
      }
      const hexRouteControlRequest =
        '0170d1a134a0df4f47964f6e19e2ab379000000020010203666f6f03626172'

      it('can serialize Route Control Request Payload', function () {
        assert.strictEqual(
          CCP.serializeCcpRouteControlRequestPayload(routeControlRequest).toString('hex'),
          hexRouteControlRequest
        )
      })

      it('can deserialize Route Control Request Payload', function () {
        assert.deepEqual(
          CCP.deserializeCcpRouteControlRequestPayload(Buffer.from(hexRouteControlRequest, 'hex')),
          routeControlRequest
        )
      })
    })

    describe('request', function () {
      it('should extract a CCP control request from IlpPacket', function () {
        const ccpPacket: IlpPrepare = {
          amount: '0',
          expiresAt: new Date('2015-06-16T00:01:00.000Z'),
          destination: 'peer.route.control',
          executionCondition: Buffer.from(
            '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925',
            'hex'
          ),
          data: Buffer.from(
            '0170d1a134a0df4f47964f6e19e2ab379000000020010203666f6f03626172',
            'hex'
          ),
        }
        assert.deepEqual(CCP.extractCcpRouteControlRequest(ccpPacket), {
          mode: CCP.Mode.MODE_SYNC,
          lastKnownRoutingTableId: '70d1a134-a0df-4f47-964f-6e19e2ab3790',
          lastKnownEpoch: 32,
          features: ['foo', 'bar'],
        })
      })

      it('should construct an ILP Prepare CCP control request from CCP', function () {
        const ccpControlRequest: CCP.CcpRouteControlRequest = {
          mode: CCP.Mode.MODE_SYNC,
          lastKnownRoutingTableId: '70d1a134-a0df-4f47-964f-6e19e2ab3790',
          lastKnownEpoch: 32,
          features: ['foo', 'bar'],
        }
        assert.deepEqual(CCP.constructCcpRouteControlRequest(ccpControlRequest), {
          amount: '0',
          expiresAt: new Date('2015-06-16T00:01:00.000Z'),
          destination: 'peer.route.control',
          executionCondition: Buffer.from(
            '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925',
            'hex'
          ),
          data: Buffer.from(
            '0170d1a134a0df4f47964f6e19e2ab379000000020010203666f6f03626172',
            'hex'
          ),
        })
      })
    })
  })

  describe('Route Control Update', function () {
    describe('payload', function () {
      const routeControlUpdate: CCP.CcpRouteUpdateRequest = {
        routingTableId: '21e55f8e-abcd-4e97-9ab9-bf0ff00a224c',
        currentEpochIndex: 52,
        fromEpochIndex: 52,
        toEpochIndex: 52,
        holdDownTime: 30000,
        speaker: 'example.alice',
        newRoutes: [],
        withdrawnRoutes: [],
      }
      const hexRouteControlUpdate =
        '21e55f8eabcd4e979ab9bf0ff00a224c000000340000003400000034000075300d6578616d706c652e616c69636501000100'

      it('can serialize Route Control Update Payload', function () {
        assert.strictEqual(
          CCP.serializeCcpRouteUpdateRequestPayload(routeControlUpdate).toString('hex'),
          hexRouteControlUpdate
        )
      })

      it('can deserialize Route Control Update Payload', function () {
        assert.deepEqual(
          CCP.deserializeCcpRouteUpdateRequestPayload(Buffer.from(hexRouteControlUpdate, 'hex')),
          routeControlUpdate
        )
      })
    })

    describe('request', function () {
      it('should extract a CCP control Update from IlpPacket', function () {
        const ccpPacket: IlpPrepare = {
          amount: '0',
          expiresAt: new Date('2015-06-16T00:01:00.000Z'),
          destination: 'peer.route.update',
          executionCondition: Buffer.from(
            '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925',
            'hex'
          ),
          data: Buffer.from(
            '21e55f8eabcd4e979ab9bf0ff00a224c000000340000003400000034000075300d6578616d706c652e616c69636501000100',
            'hex'
          ),
        }
        assert.deepEqual(CCP.extractCcpRouteUpdateRequest(ccpPacket), {
          routingTableId: '21e55f8e-abcd-4e97-9ab9-bf0ff00a224c',
          currentEpochIndex: 52,
          fromEpochIndex: 52,
          toEpochIndex: 52,
          holdDownTime: 30000,
          speaker: 'example.alice',
          newRoutes: [],
          withdrawnRoutes: [],
        })
      })

      it('should construct an ILP Prepare CCP update request from CCP', function () {
        const ccpRouteUpdateRequest: CCP.CcpRouteUpdateRequest = {
          routingTableId: '21e55f8e-abcd-4e97-9ab9-bf0ff00a224c',
          currentEpochIndex: 52,
          fromEpochIndex: 52,
          toEpochIndex: 52,
          holdDownTime: 30000,
          speaker: 'example.alice',
          newRoutes: [],
          withdrawnRoutes: [],
        }
        assert.deepEqual(CCP.constructCcpRouteUpdateRequest(ccpRouteUpdateRequest), {
          amount: '0',
          expiresAt: new Date('2015-06-16T00:01:00.000Z'),
          destination: 'peer.route.update',
          executionCondition: Buffer.from(
            '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925',
            'hex'
          ),
          data: Buffer.from(
            '21e55f8eabcd4e979ab9bf0ff00a224c000000340000003400000034000075300d6578616d706c652e616c69636501000100',
            'hex'
          ),
        })
      })
    })
  })

  describe('Route Control Response', function () {
    it('can construct ILP Fulfill Packet CCP Response', function () {
      assert.isTrue(isFulfill(CCP.constructCcpResponse()))
    })
  })

  describe('deserializeCcpControlRequest', async function () {
    it('should be a function', async function () {
      assert.isFunction(CCP.deserializeCcpRouteControlRequest)
    })

    it('should deserialize a CCP control request', async function () {
      const request = Buffer.from(
        '0c6c0000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f292512706565722e726f7574652e636f6e74726f6c1f0170d1a134a0df4f47964f6e19e2ab379000000020010203666f6f03626172',
        'hex'
      )

      assert.deepEqual(CCP.deserializeCcpRouteControlRequest(request), {
        mode: CCP.Mode.MODE_SYNC,
        lastKnownRoutingTableId: '70d1a134-a0df-4f47-964f-6e19e2ab3790',
        lastKnownEpoch: 32,
        features: ['foo', 'bar'],
      })
    })

    it('should fail to parse an CCP request with the wrong destination', async function () {
      const request = Buffer.from(
        '0c6c0000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f292512706565722e726f7574652e636f6e74726f6b1f0170d1a134a0df4f47964f6e19e2ab379000000020010203666f6f03626172',
        'hex'
      )

      assert.throws(
        () => CCP.deserializeCcpRouteControlRequest(request),
        'packet is not a CCP route control request.'
      )
    })

    it('should fail to parse a CCP request with the wrong condition', async function () {
      const request = Buffer.from(
        '0c6c0000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e21089714856ee233b3902a591d0d5f292512706565722e726f7574652e636f6e74726f6c1f0170d1a134a0df4f47964f6e19e2ab379000000020010203666f6f03626172',
        'hex'
      )

      assert.throws(
        () => CCP.deserializeCcpRouteControlRequest(request),
        'packet does not contain correct condition for a peer protocol request.'
      )
    })

    it('should fail to parse an expired CCP request', async function () {
      const request = Buffer.from(
        '0c6c0000000000000000323031343036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f292512706565722e726f7574652e636f6e74726f6c1f0170d1a134a0df4f47964f6e19e2ab379000000020010203666f6f03626172',
        'hex'
      )

      assert.throws(
        () => CCP.deserializeCcpRouteControlRequest(request),
        'CCP route control request packet is expired.'
      )
    })
  })

  describe('serializeCcpRouteControlRequest', async function () {
    it('should be a function', async function () {
      assert.isFunction(CCP.serializeCcpRouteControlRequest)
    })

    it('should serialize a CCP route update request', async function () {
      assert.equal(
        CCP.serializeCcpRouteControlRequest({
          mode: CCP.Mode.MODE_SYNC,
          lastKnownRoutingTableId: '70d1a134-a0df-4f47-964f-6e19e2ab3790',
          lastKnownEpoch: 32,
          features: ['foo', 'bar'],
        }).toString('hex'),
        '0c6c0000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f292512706565722e726f7574652e636f6e74726f6c1f0170d1a134a0df4f47964f6e19e2ab379000000020010203666f6f03626172'
      )
    })
  })

  describe('deserializeCcpRouteUpdateRequest', async function () {
    it('should be a function', async function () {
      assert.isFunction(CCP.deserializeCcpRouteUpdateRequest)
    })

    it('should deserialize a simple CCP route update request', async function () {
      const request = Buffer.from(
        '0c7e0000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f292511706565722e726f7574652e7570646174653221e55f8eabcd4e979ab9bf0ff00a224c000000340000003400000034000075300d6578616d706c652e616c69636501000100',
        'hex'
      )

      assert.deepEqual(CCP.deserializeCcpRouteUpdateRequest(request), {
        routingTableId: '21e55f8e-abcd-4e97-9ab9-bf0ff00a224c',
        currentEpochIndex: 52,
        fromEpochIndex: 52,
        toEpochIndex: 52,
        holdDownTime: 30000,
        speaker: 'example.alice',
        newRoutes: [],
        withdrawnRoutes: [],
      })
    })

    it('should deserialize a complex CCP route update request', async function () {
      const request = Buffer.from(
        '0c8201520000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f292511706565722e726f7574652e757064617465820104bffbf6ad0ddc4d3ba1e5b4f0537365bd000000340000002e00000032000075300d6578616d706c652e616c69636501020f6578616d706c652e7072656669783101010f6578616d706c652e707265666978317a6c7d85867c46a2fabfad1afa7a4a5e229ce574fcce63f5edeedfc03f8468ea01000f6578616d706c652e707265666978320102126578616d706c652e636f6e6e6563746f72310f6578616d706c652e707265666978322b08e53fbcc17c5f1bd54ae0d9ad7ba39a5f9a7b126ca9b5c0945609a35324cc01025000000b68656c6c6f20776f726c64e0000104a0a0a0a001020f6578616d706c652e707265666978330f6578616d706c652e70726566697834',
        'hex'
      )

      assert.deepEqual(CCP.deserializeCcpRouteUpdateRequest(request), {
        routingTableId: 'bffbf6ad-0ddc-4d3b-a1e5-b4f0537365bd',
        currentEpochIndex: 52,
        fromEpochIndex: 46,
        toEpochIndex: 50,
        holdDownTime: 30000,
        speaker: 'example.alice',
        newRoutes: [
          {
            prefix: 'example.prefix1',
            path: ['example.prefix1'],
            auth: Buffer.from('emx9hYZ8RqL6v60a+npKXiKc5XT8zmP17e7fwD+EaOo=', 'base64'),
            props: [],
          },
          {
            prefix: 'example.prefix2',
            path: ['example.connector1', 'example.prefix2'],
            auth: Buffer.from('KwjlP7zBfF8b1Urg2a17o5pfmnsSbKm1wJRWCaNTJMw=', 'base64'),
            props: [
              {
                isOptional: false,
                isTransitive: true,
                isPartial: false,
                isUtf8: true,
                id: 0,
                value: 'hello world',
              },
              {
                isOptional: true,
                isTransitive: true,
                isPartial: true,
                isUtf8: false,
                id: 1,
                value: Buffer.from('a0a0a0a0', 'hex'),
              },
            ],
          },
        ],
        withdrawnRoutes: ['example.prefix3', 'example.prefix4'],
      })
    })

    it('should fail to parse a CCP route update request with the wrong destination', async function () {
      const request = Buffer.from(
        '0c7e0000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f292511706565722e726f7574652e7570646174643221e55f8eabcd4e979ab9bf0ff00a224c000000340000003400000034000075300d6578616d706c652e616c69636501000100',
        'hex'
      )

      assert.throws(
        () => CCP.deserializeCcpRouteUpdateRequest(request),
        'packet is not a CCP route update request.'
      )
    })

    it('should fail to parse a CCP route update request with the wrong condition', async function () {
      const request = Buffer.from(
        '0c7e0000000000000000323031353036313630303031303030303066687aadf862bd776c8fd18b8e9f8e20089714856ee233b3902a591d0d5f292511706565722e726f7574652e7570646174653221e55f8eabcd4e979ab9bf0ff00a224c000000340000003400000034000075300d6578616d706c652e616c69636501000100',
        'hex'
      )

      assert.throws(
        () => CCP.deserializeCcpRouteUpdateRequest(request),
        'packet does not contain correct condition for a peer protocol request.'
      )
    })

    it('should fail to parse an expired CCP route update request', async function () {
      const request = Buffer.from(
        '0c7e0000000000000000323031343036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f292511706565722e726f7574652e7570646174653221e55f8eabcd4e979ab9bf0ff00a224c000000340000003400000034000075300d6578616d706c652e616c69636501000100',
        'hex'
      )

      assert.throws(
        () => CCP.deserializeCcpRouteUpdateRequest(request),
        'CCP route update request packet is expired.'
      )
    })
  })

  describe('serializeCcpRouteUpdateRequest', async function () {
    it('should be a function', async function () {
      assert.isFunction(CCP.serializeCcpRouteUpdateRequest)
    })

    it('should serialize a simple CCP route update request', async function () {
      assert.equal(
        CCP.serializeCcpRouteUpdateRequest({
          routingTableId: '21e55f8e-abcd-4e97-9ab9-bf0ff00a224c',
          currentEpochIndex: 52,
          fromEpochIndex: 52,
          toEpochIndex: 52,
          holdDownTime: 30000,
          speaker: 'example.alice',
          newRoutes: [],
          withdrawnRoutes: [],
        }).toString('hex'),
        '0c7e0000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f292511706565722e726f7574652e7570646174653221e55f8eabcd4e979ab9bf0ff00a224c000000340000003400000034000075300d6578616d706c652e616c69636501000100'
      )
    })

    it('should serialize a CCP route update request', async function () {
      assert.equal(
        CCP.serializeCcpRouteUpdateRequest({
          routingTableId: 'bffbf6ad-0ddc-4d3b-a1e5-b4f0537365bd',
          currentEpochIndex: 52,
          fromEpochIndex: 46,
          toEpochIndex: 50,
          holdDownTime: 30000,
          speaker: 'example.alice',
          newRoutes: [
            {
              prefix: 'example.prefix1',
              path: ['example.prefix1'],
              auth: Buffer.from('emx9hYZ8RqL6v60a+npKXiKc5XT8zmP17e7fwD+EaOo=', 'base64'),
              props: [],
            },
            {
              prefix: 'example.prefix2',
              path: ['example.connector1', 'example.prefix2'],
              auth: Buffer.from('KwjlP7zBfF8b1Urg2a17o5pfmnsSbKm1wJRWCaNTJMw=', 'base64'),
              props: [
                {
                  isOptional: false,
                  isTransitive: true,
                  isPartial: false,
                  isUtf8: true,
                  id: 0,
                  value: 'hello world',
                },
                {
                  isOptional: true,
                  isTransitive: true,
                  isPartial: true,
                  isUtf8: false,
                  id: 1,
                  value: Buffer.from('a0a0a0a0', 'hex'),
                },
              ],
            },
          ],
          withdrawnRoutes: ['example.prefix3', 'example.prefix4'],
        }).toString('hex'),
        '0c8201520000000000000000323031353036313630303031303030303066687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f292511706565722e726f7574652e757064617465820104bffbf6ad0ddc4d3ba1e5b4f0537365bd000000340000002e00000032000075300d6578616d706c652e616c69636501020f6578616d706c652e7072656669783101010f6578616d706c652e707265666978317a6c7d85867c46a2fabfad1afa7a4a5e229ce574fcce63f5edeedfc03f8468ea01000f6578616d706c652e707265666978320102126578616d706c652e636f6e6e6563746f72310f6578616d706c652e707265666978322b08e53fbcc17c5f1bd54ae0d9ad7ba39a5f9a7b126ca9b5c0945609a35324cc01025000000b68656c6c6f20776f726c64e0000104a0a0a0a001020f6578616d706c652e707265666978330f6578616d706c652e70726566697834'
      )
    })
  })

  describe('deserializeCcpResponse', async function () {
    it('should be a function', async function () {
      assert.isFunction(CCP.deserializeCcpResponse)
    })

    it('should deserialize an CCP response', async function () {
      const response = Buffer.from(
        '0d350000000000000000000000000000000000000000000000000000000000000000140e6578616d706c652e636c69656e740d0358414d',
        'hex'
      )

      // should not throw
      CCP.deserializeCcpResponse(response)
    })

    it('should fail if the response contains the wrong fulfillment', async function () {
      const request = Buffer.from(
        '0d350000000000000000000000000000100000000000000000000000000000000000140e6578616d706c652e636c69656e740d0358414d',
        'hex'
      )

      assert.throws(
        () => CCP.deserializeCcpResponse(request),
        'CCP response does not contain the expected fulfillment.'
      )
    })
  })

  describe('serializeCcpResponse', async function () {
    it('should be a function', async function () {
      assert.isFunction(CCP.serializeCcpResponse)
    })

    it('should serialize an CCP response', async function () {
      assert.equal(
        CCP.serializeCcpResponse().toString('hex'),
        '0d21000000000000000000000000000000000000000000000000000000000000000000'
      )
    })
  })
})
