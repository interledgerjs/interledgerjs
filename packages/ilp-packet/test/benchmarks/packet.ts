const Benchmark = require('benchmark')
import * as PacketV1 from '../..'
const packageV0 = process.argv[2]
if (!packageV0) {
  console.error('usage: node ' + process.argv.slice(0, 2).join(' ') + ' <v0>')
  process.exit(1)
}
const PacketV0 = require(packageV0)

const prepareObject = {
  amount: '107',
  executionCondition: Buffer.from('dOETbcccnl8oO+yDRhy/EmHEAU9y1I+N1lRToLhOfeE=', 'base64'),
  expiresAt: new Date('2017-12-23T01:21:40.549Z'),
  destination: 'example.alice',
  data: Buffer.from('XbND/cQYmPbfQgIykTncJC3Q9VioEbRrKJGP2rN8bLA=', 'base64')
}
const prepareBuffer = PacketV1.serializeIlpPrepare(prepareObject)

const fulfillObject = {
  fulfillment: Buffer.from('w4ZrSHSczxE7LhXCXSQH+/wUR2/nKWuxvxvNnm5BZlA=', 'base64'),
  data: Buffer.from('Zz/r14ozso4cDbFMmgYlGgX6gx7U7ZHrzRUOcknC5gA=', 'base64')
}
const fulfillBuffer = PacketV1.serializeIlpFulfill(fulfillObject)

const rejectObject = {
  code: 'F01',
  triggeredBy: 'example.us.bob',
  message: 'missing destination. ledger=example.us.',
  data: Buffer.from('AAAABBBB', 'base64')
}
const rejectBuffer = PacketV1.serializeIlpReject(rejectObject)

;(new Benchmark.Suite('serializeIlpPrepare'))
  .add('v0', function () { PacketV0.serializeIlpPrepare(prepareObject) })
  .add('v1', function () { PacketV1.serializeIlpPrepare(prepareObject) })
  .on('cycle', function(event: any) {
    console.log(this.name, '\t', String(event.target));
  })
  .run({})

;(new Benchmark.Suite('deserializeIlpPrepare'))
  .add('v0', function () { PacketV0.deserializeIlpPacket(prepareBuffer) })
  .add('v1', function () { PacketV1.deserializeIlpPacket(prepareBuffer) })
  .on('cycle', function(event: any) {
    console.log(this.name, '\t', String(event.target));
  })
  .run({})

;(new Benchmark.Suite('serializeIlpFulfill'))
  .add('v0', function () { PacketV0.serializeIlpFulfill(fulfillObject) })
  .add('v1', function () { PacketV1.serializeIlpFulfill(fulfillObject) })
  .on('cycle', function(event: any) {
    console.log(this.name, '\t', String(event.target));
  })
  .run({})

;(new Benchmark.Suite('deserializeIlpFulfill'))
  .add('v0', function () { PacketV0.deserializeIlpFulfill(fulfillBuffer) })
  .add('v1', function () { PacketV1.deserializeIlpFulfill(fulfillBuffer) })
  .on('cycle', function(event: any) {
    console.log(this.name, '\t', String(event.target));
  })
  .run({})

;(new Benchmark.Suite('serializeIlpReject'))
  .add('v0', function () { PacketV0.serializeIlpReject(rejectObject) })
  .add('v1', function () { PacketV1.serializeIlpReject(rejectObject) })
  .on('cycle', function(event: any) {
    console.log(this.name, '\t', String(event.target));
  })
  .run({})

;(new Benchmark.Suite('deserializeIlpReject'))
  .add('v0', function () { PacketV0.deserializeIlpReject(rejectBuffer) })
  .add('v1', function () { PacketV1.deserializeIlpReject(rejectBuffer) })
  .on('cycle', function(event: any) {
    console.log(this.name, '\t', String(event.target));
  })
  .run({})
