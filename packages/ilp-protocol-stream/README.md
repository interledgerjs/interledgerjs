# ILP STREAMing Transport for Real-time Exchange of Assets and Messaging (ILP/STREAM)
> Interledger transport protocol for multiplexing streams of money and data over a virtual ILP connection.

ILP/STREAM is a successor to [PSK2](https://github.com/interledger/rfcs/blob/master/0025-pre-shared-key-2/0025-pre-shared-key-2.md) that handles sending multiple streams of money and data over a single ILP "connection" between a client and server. It automatically handles flow control, backpressure, exchange rates, multiple classes of errors, data encryption and authentication, and condition and fulfillment generation.

This protocol combines the lessons learned from PSK with significant inspiration from the [QUIC](https://tools.ietf.org/html/draft-ietf-quic-transport-10) internet transport protocol.

## Getting Started

```sh
npm install --save https://github.com/interledgerjs/ilp-protocol-stream
```

See [`example.js`](./example.js) or the TSDoc for the usage.

## TODOs

- [x] Quoting
- [x] Minimum destination amount and amount arrived
- [x] Track exchange rate and apply slippage
- [x] Prevent replay attacks and ensure response is correctly on fulfill or reject
- [x] Determine Max Packet Amount
- [x] Events to know when money has been fully sent
- [x] Retry temporary errors
- [x] Combine always needed frames into one (and make it appear first?)
- [x] Length-prefix frames for extensibility?
- [x] Backpressure
- [x] Helper functions for sending / receiving and waiting until it's finished
- [x] Handle stream closing
- [x] Protocol error frame
- [x] Padding frame
- [x] Data stream
- [ ] Don't send extra packet at the end if it isn't necessary
- [ ] Max number of streams
- [ ] Blocked frames (when more is available to send)
- [ ] Should money and data streams use different sets of numbers for stream ids?
- [ ] Refactor handleData and sendPacket functions to make them easier to understand and reason about

## Credits

Thanks to @sharafian for coming up with the acronym for STREAM.