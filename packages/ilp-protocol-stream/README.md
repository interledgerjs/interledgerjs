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
- [x] Connection closing
- [x] Max number of streams
- [x] stream.end should accept data like node stream
- [x] Separate connection "end" and "destroy", where the former flushes everything first
- [x] Use stream.destroy instead of end to close immediately -- end should flush data and money and emit finish or whatever when it's done, destroy closes it right away
- [x] Test connection.destroy
- [ ] connection.end should only close it when the streams are finished sending
- [ ] Backpressure for data
- [ ] Add ACKs for data or only send data in prepares
- [ ] Clean up closed streams (and throw error if packet is received for a closed stream)
- [ ] Should we keep "shares" as the way to express how much money goes to each stream or switch to Michiel's idea of expressing ax + b to allow for relative and absolute amounts?
- [ ] When waiting to receive money, occasionally resend the max receive amount in case the sender hasn't gotten it (and also send it if they send too much)
- [ ] Multiple packets in flight at the same time
- [ ] Don't send extra packet at the end if it isn't necessary
- [ ] Blocked frames (when more is available to send)
- [ ] Refactor handleData and sendPacket functions to make them easier to understand and reason about
- [ ] Use `ilp-plugin` to get plugin from environment
- [ ] Drop connection when it has sent a certain number of packets
- [ ] Randomize expiry time
- [ ] Merge sending test and normal packets? Or at least handle frames in the same way
- [ ] Make it work even if one side can only receive 0 amount packets
- [ ] Add timeouts for lack of activity
- [ ] Handle plugin disconnecting

## Credits

Thanks to @sharafian for coming up with the acronym for STREAM.
