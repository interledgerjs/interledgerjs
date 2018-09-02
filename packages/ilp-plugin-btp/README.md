# ILP Plugin BTP
> One plugin to rule them all

[![NPM Package](https://img.shields.io/npm/v/ilp-plugin-btp.svg?style=flat)](https://npmjs.org/package/ilp-plugin-btp)
[![CircleCI](https://circleci.com/gh/interledgerjs/ilp-plugin-btp.svg?style=shield)](https://circleci.com/gh/interledgerjs/ilp-plugin-btp)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![Known Vulnerabilities](https://snyk.io/test/github/interledgerjs/ilp-plugin-btp/badge.svg)](https://snyk.io/test/github/interledgerjs/ilp-plugin-btp) [![Greenkeeper badge](https://badges.greenkeeper.io/interledgerjs/ilp-plugin-btp.svg)](https://greenkeeper.io/)

Used right out of the box, this plugin is capable of representing a data
channel with no money involved. It will send BTP messages with no knowledge
of the data within, so it can be used for ILP packets. The `sendMoney` function
is a no-op, because there is no system involved handling money.

The main use of this plugin, however, is as a building block for plugins that
do have an underlying ledger. In this way, it's the successor of
[`ilp-plugin-payment-channel-framework`](https://github.com/interledgerjs/ilp-plugin-payment-channel-framework)

Plugins that sub-class the `AbstractBtpPlugin` should override `sendMoney` and `_handleMoney` at least.

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
* `_handleMoney (from: string, btpPacket: BtpPacket) -> Promise<Array<BtpSubProtocol>>`: This function is called on an incoming BTP `TRANSFER`.

BtpSubProtocol is made up of:

* `protocolName: string`: The name of this side protocol. ILP-level information must be named `ilp`.
* `contentType: number`: The content type. 0 is `application/octet-stream`, 1 is `text/plain-utf8`, and 2 is `application/json`. Mainly used for logging and smart deserializing.
* `data: buffer`: The actual protocol data.
