# ILP/STREAM: Multiplexed Money and Data Streams
> Interledger transport protocol for multiplexing streams of money and data over an ILP connection.

Implementation of [ILP/STREAM](https://github.com/interledger/rfcs/pull/417). This module handles sending multiple streams of money and data over a single ILP connection between a client and server. It automatically handles flow control, backpressure, exchange rates, multiple classes of errors, data encryption and authentication, and condition and fulfillment generation.

## Getting Started

```sh
npm install --save ilp-protocol-stream
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
- [x] Should money and data streams use different sets of numbers for stream ids?
- [ ] Multiple packets in flight at the same time
- [ ] Backpressure for data streams
- [ ] Connection closing
- [ ] Don't send extra packet at the end if it isn't necessary
- [ ] Max number of streams
- [ ] Blocked frames (when more is available to send)
- [ ] Refactor handleData and sendPacket functions to make them easier to understand and reason about
- [ ] Use `ilp-plugin` to get plugin from environment

## Credits

Thanks to @sharafian for coming up with the acronym for STREAM.