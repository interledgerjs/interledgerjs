# ILP Plugin BTP
> One plugin to rule them all

Used right out of the box, this plugin is capable of representing a data
channel with no money involved. It will send BTP messages with no knowledge
of the data within, so it can be used for ILP packets. The `sendMoney` function
is a no-op, because there is no system involved handling money.

The main use of this plugin, however, is as a building block for plugins that
do have an underlying ledger. In this way, it's the successor of
[`ilp-plugin-payment-channel-framework`](https://github.com/interledgerjs/ilp-plugin-payment-channel-framework)

## Use as a Data Channel for ILP

```js
const server = new BtpPlugin({
  listener: {
    port: 9000,
    secret: 'shh_its_a_secret'
  }
})

await server.connect()

const client = new BtpPlugin({
  server: 'btp+ws://:shh_its_a_secret@localhost:9000'
})

await client.connect()

server.registerDataHandler(serverHandler)
client.registerDataHandler(clientHandler)

await client.sendData(IlpPacket.serializeIlpPrepare({
  // ...
})
```

## Use as a Base Class for a New Plugin

Two functions must be defined in order for the plugin to handle money.

* `sendMoney (amount: string) -> Promise<null>`: sends `amount` of units to the peer. This should be done via a BTP `TRANSFER` call.
* `handleMoney (from: null, { requestId: number, data: { amount: string, protocolData: Array<ProtocolData> } }) -> Array<ProtocolData>`: This function is called on an incoming BTP `TRANSFER`.

ProtocolData is made up of:

* `protocolName: string`: The name of this side protocol. ILP-level information must be named `ilp`.
* `contentType: number`: The content type. 0 is `application/octet-stream`, 1 is `text/plain-utf8`, and 2 is `application/json`. Mainly used for logging and smart deserializing.
* `data: buffer`: The actual protocol data.
