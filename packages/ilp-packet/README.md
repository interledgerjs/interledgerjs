# ILP Packet

[![Greenkeeper badge](https://badges.greenkeeper.io/interledgerjs/ilp-packet.svg)](https://greenkeeper.io/)

[![npm][npm-image]][npm-url] [![circle][circle-image]][circle-url] [![codecov][codecov-image]][codecov-url]

[npm-image]: https://img.shields.io/npm/v/ilp-packet.svg?style=flat
[npm-url]: https://npmjs.org/package/ilp-packet
[circle-image]: https://circleci.com/gh/interledgerjs/ilp-packet.svg?style=shield
[circle-url]: https://circleci.com/gh/interledgerjs/ilp-packet
[codecov-image]: https://codecov.io/gh/interledgerjs/ilp-packet/branch/master/graph/badge.svg
[codecov-url]: https://codecov.io/gh/interledgerjs/ilp-packet

> A serializer and deserializer for ILP packets and messages

## Usage

### Installation

```sh
npm install ilp-packet
```

### Deserialize any ILP packet

```js
const IlpPacket = require('ilp-packet')

const binaryPacket = Buffer.from('0c68000000000000006b323031373132323330313231343035343974e1136dc71c9e5f283bec83461cbf1261c4014f72d48f8dd65453a0b84e7de10d6578616d706c652e616c696365205db343fdc41898f6df4202329139dc242dd0f558a811b46b28918fdab37c6cb0', 'hex')
const jsonPacket = IlpPacket.deserializeIlpPacket(binaryPacket)
console.log(jsonPacket)
// {
//   type: 12,
//   typeString: 'ilp_prepare',
//   data: {
//     amount: '107',
//     executionCondition: Buffer.from('dOETbcccnl8oO+yDRhy/EmHEAU9y1I+N1lRToLhOfeE=', 'base64')
//     expiresAt: new Date('2017-12-23T01:21:40.549Z'),
//     destination: 'example.alice',
//     data: Buffer.from('XbND/cQYmPbfQgIykTncJC3Q9VioEbRrKJGP2rN8bLA=', 'base64')
//   }
// }
```

### Serialize PREPARE, FULFILL, REJECT

```js
const IlpPacket = require('ilp-packet')
const crypto = require('crypto')
function sha256 (preimage) {
  return crypto.createHash('sha256').update(preimage).digest()
}

const fulfillment = crypto.randomBytes(32)
const condition = sha256(fulfillment)

const binaryPrepare = IlpPacket.serializeIlpPrepare({
  amount: '10',
  executionCondition: condition,
  destination: 'g.us.nexus.bob', // this field was called 'account' in older packet types
  data: Buffer.from('hello world'),
  expiresAt: new Date(new Date().getTime() + 10000)
})

const binaryFulfill = IlpPacket.serializeIlpFulfill({
  fulfillment,
  data: Buffer.from('thank you')
})

const binaryReject = IlpPacket.serializeIlpReject({
  code: 'F00',
  triggeredBy: 'g.us.nexus.gateway',
  message: 'more details, human-readable',
  data: Buffer.from('more details, machine-readable')
})
```
