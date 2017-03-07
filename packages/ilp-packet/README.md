# ILP Packet

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

### As a module

```js
const packet = require('ilp-packet')

const binaryPacket = packet.serializeIlpPayment({
  amount: '123000000',       // Unsigned 64-bit integer as a string
  account: 'g.us.nexus.bob', // ILP Address
  data: 'BBBB'               // Base64url-encoded attached data
}) // returns a Buffer

console.log(binaryPacket.toString('hex'))
// prints "011c000000000754d4c00e672e75732e6e657875732e626f620304104100"

const jsonPacket = packet.deserializeIlpPayment(binaryPacket)
```
