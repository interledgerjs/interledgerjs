import * as crypto from 'crypto'
const Benchmark = require('benchmark')
import * as PacketV1 from '../../src/packet'
const packageV0 = process.argv[2]
if (!packageV0) {
  console.error('usage: node ' + process.argv.slice(0, 2).join(' ') + ' <v0>')
  process.exit(1)
}
const PacketV0 = require(packageV0)

const moneyPacketV0 = new PacketV0.Packet(0, 14, 5, [
  new PacketV0.StreamMoneyFrame(1, 1),
  new PacketV0.StreamMoneyFrame(2, 2)
])

const moneyPacketV1 = new PacketV1.Packet(0, 14, 5, [
  new PacketV1.StreamMoneyFrame(1, 1),
  new PacketV1.StreamMoneyFrame(2, 2)
])

// TODO test data & control frames

const encryptionKey = crypto.randomBytes(32)
const packetBuffer = moneyPacketV0._serialize()

;(new Benchmark.Suite('serialize:   MoneyFrame'))
  .add('v0', function () { moneyPacketV0._serialize() })
  .add('v1', function () { moneyPacketV1._serialize() })
  .on('cycle', function(event: any) {
    console.log(this.name, '\t', String(event.target));
  })
  .run({})

;(new Benchmark.Suite('deserialize: MoneyFrame'))
  .add('v0', function () { PacketV0.Packet._deserializeUnencrypted(packetBuffer) })
  .add('v1', function () { PacketV1.Packet._deserializeUnencrypted(packetBuffer) })
  .on('cycle', function(event: any) {
    console.log(this.name, '\t', String(event.target));
  })
  .run({})
