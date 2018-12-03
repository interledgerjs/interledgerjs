const Benchmark = require('benchmark')
import * as PacketV1 from '../../src'
const packageV0 = process.argv[2]
if (!packageV0) {
  console.error('usage: node ' + process.argv.slice(0, 2).join(' ') + ' <v0>')
  process.exit(1)
}
const PacketV0 = require(packageV0)

const responseObject = {
  clientAddress: 'example.client',
  assetScale: 13,
  assetCode: 'XAM'
}
const responseBuffer = PacketV0.serializeIldcpResponse(responseObject)

;(new Benchmark.Suite('serializeIldcpResponse  '))
  .add('v0', function () { PacketV0.serializeIldcpResponse(responseObject) })
  .add('v1', function () { PacketV1.serializeIldcpResponse(responseObject) })
  .on('cycle', function (event: any) {
    console.log(this.name, '\t', String(event.target))
  })
  .run({})

;(new Benchmark.Suite('deserializeIldcpResponse'))
  .add('v0', function () { PacketV0.deserializeIldcpResponse(responseBuffer) })
  .add('v1', function () { PacketV1.deserializeIldcpResponse(responseBuffer) })
  .on('cycle', function (event: any) {
    console.log(this.name, '\t', String(event.target))
  })
  .run({})
