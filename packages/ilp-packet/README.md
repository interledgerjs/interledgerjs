# ILP Packet

[![npm][npm-image]][npm-url]

[npm-image]: https://img.shields.io/npm/v/ilp-packet.svg?style=flat
[npm-url]: https://npmjs.org/package/ilp-packet

> A serializer and deserializer for ILP packets and messages

## Usage

### Install

```sh
npm install ilp-packet
```

### Serialize PREPARE, FULFILL, REJECT

```js
const IlpPacket = require('ilp-packet')
const crypto = require('crypto')
function sha256(preimage) {
  return crypto.createHash('sha256').update(preimage).digest()
}

const fulfillment = crypto.randomBytes(32)
const condition = sha256(fulfillment)

const binaryPrepare = IlpPacket.serializeIlpPrepare({
  amount: '10',
  executionCondition: condition,
  destination: 'g.us.nexus.bob',
  data: Buffer.from('hello world'),
  expiresAt: new Date(new Date().getTime() + 10000),
})

const binaryFulfill = IlpPacket.serializeIlpFulfill({
  fulfillment,
  data: Buffer.from('thank you'),
})

const binaryReject = IlpPacket.serializeIlpReject({
  code: 'F00',
  triggeredBy: 'g.us.nexus.gateway',
  message: 'more details, human-readable',
  data: Buffer.from('more details, machine-readable'),
})
```

## Types

### `IlpPrepare`

| Property                 | Type     |
| ------------------------ | -------- |
| **`amount`**             | `string` |
| **`executionCondition`** | `Buffer` |
| **`expiresAt`**          | `Date`   |
| **`destination`**        | `string` |
| **`data`**               | `Buffer` |

### `IlpFulfill`

| Property          | Type     |
| ----------------- | -------- |
| **`fulfillment`** | `Buffer` |
| **`data`**        | `Buffer` |

### `IlpReject`

| Property          | Type           |
| ----------------- | -------------- |
| **`code`**        | `IlpErrorCode` |
| **`triggeredBy`** | `string`       |
| **`message`**     | `string`       |
| **`data`**        | `Buffer`       |
