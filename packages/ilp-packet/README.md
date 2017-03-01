# ILP Packet

> A serializer and deserializer for ILP packets and messages

## Usage

### Installation

```sh
npm install ilp-packet
```

### As a module

```js
const packet = require('ilp-packet')

const binaryPacket = packet.serialize({
  type: 'ilp',               // Always "ilp"
  amount: '123000000',       // Unsigned 64-bit integer as a string
  account: 'g.us.nexus.bob', // ILP Address
  data: 'BBBB'               // Base64url-encoded attached data
}) // returns a Buffer

console.log(binaryPacket.toString('hex'))
// prints "011c000000000754d4c00e672e75732e6e657875732e626f620304104100"

const jsonPacket = packet.deserialize(binaryPacket)
```
