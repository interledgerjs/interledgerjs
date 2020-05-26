## `@interledger/pay` :money_with_wings:

> Send payments over Interledger

[![NPM Package](https://img.shields.io/npm/v/@interledger/pay.svg?style=flat&logo=npm)](https://npmjs.org/package/@interledger/pay)
[![GitHub Actions](https://img.shields.io/github/workflow/status/interledgerjs/interledgerjs/master.svg?style=flat&logo=github)](https://circleci.com/gh/interledgerjs/interledgerjs/master)
[![Codecov](https://img.shields.io/codecov/c/github/interledgerjs/interledgerjs/master.svg?logo=codecov&flag=pay)](https://codecov.io/gh/interledgerjs/interledgerjs/tree/master/packages/pay/src)
[![Prettier](https://img.shields.io/badge/code_style-prettier-brightgreen.svg)](https://prettier.io/)

### Install

```bash
npm i @interledger/pay
```

Or using Yarn:

```bash
yarn add @interledger/pay
```

### Usage

#### Fixed Delivery Payment

```js
import { quote } from '@interledger/pay'

const { pay, cancel, ...details } = await quote({
  plugin,
  paymentPointer: '$rafiki.money/p/example',
  amountToDeliver: '0.0234',
  destinationAssetCode: 'XYZ',
  destinationAssetScale: 4
})
console.log(details)
// {
//   maxSourceAmount: BigNumber(0.000198),
//   estimatedExchangeRate: [BigNumber(1.2339), BigNumber(1.23423)],
//   minExchangeRate: BigNumber(1.21),
//   sourceAccount: {
//     ilpAddress: 'test.xpring.hermes.23r8gdsb_72badfnm',
//     assetCode: 'ABC',
//     assetScale: 6
//   },
//   destinationAccount: {
//     ilpAddress: 'test.rafiki.us1.users.example',
//     assetCode: 'XYZ',
//     assetScale: 4
//   }
// }

// Choose to execute the payment...
const receipt = await pay()
console.log(receipt)
// {
//    amountSent: BigNumber(0.000191),
//    amountInFlight: BigNumber(0),
//    amountDelivered: BigNumber(0.0234),
//    ...
// }

// ...or decline: disconnect and close the connection
await cancel()
```

#### Fixed Source Amount Payment

```js
import { quote } from '@interledger/pay'

const { pay, ...details } = await quote({
  plugin,
  paymentPointer: '$rafiki.money/p/example',
  amountToSend: '3.14159'
})

const receipt = await pay()
```

#### Error Handling

If quoting fails, it will reject the Promise with a variant of the `PaymentError` enum. For example:

```js
import { quote, PaymentError } from '@interledger/pay'

try {
  await quote({ ... })
} catch (err) {
  if (err === PaymentError.InvalidPaymentPointer) {
    console.log('Payment pointer is invalid!')
  }

  // ...
}
```

Similarily, if an error was encountered during the payment itself, it will include an `error` property on the receipt which is a `PaymentError` variant.

### API

#### `quote`

> `(options: PaymentOptions) => Promise<Quote>`

Quote and prepare to perform a payment:

- Query the recipient's payment pointer or SPSP server, if provided
- Fetch the asset and details of the sending account
- Ensure there's a viable payment path to the recipient
- Probe the realized exchange rate to the recipient
- Enforce exchange rates by comparing against rates pulled from external sources, and set the maximum amount that will be sent
- Perform other validation as a prerequisite to performing the payment

After the quote is complete, the consumer will have the option to execute or cancel the payment.

If the quote fails, it Promise will reject with a `PaymentError` variant.

#### `PaymentOptions`

Parameters to setup and prepare a payment

##### `plugin`

> [`Plugin`](https://github.com/interledger/rfcs/blob/master/deprecated/0024-ledger-plugin-interface-2/0024-ledger-plugin-interface-2.md)

Plugin to send and receive packets over a connected Interledger network. Throws `PaymentError.Disconnected` if the plugin failed to connect.

##### `paymentPointer`

> _Optional_: `string`

Payment pointer or URL of an SPSP server to setup a payment and query STREAM connection credentials. For example, `$rafiki.money/p/alice`.

Throws `PaymentError.InvalidPaymentPointer` if the payment pointer is semantically invalid. If the query to the server failed or its response was invalid, throws `PaymentError.SpspQueryFailed`.

Either `paymentPointer`, or `destinationAddress` and `sharedSecret` must be provided. Otherwise, `PaymentError.InvalidCredentials` will be thrown.

##### `destinationAddress`

> _Optional_: `string`

ILP address of the recipient, identifying this connection, which is used to send packets to their STREAM server. Throws `PaymentError.InvalidCredentials` if the destination address is not a semantically valid Interledger address.

Also requires `sharedSecret`.

##### `sharedSecret`

> _Optional_: `Buffer`

Symmetric key shared between the sender and recipient to encrypt and decrypt STREAM messages, and generate fulfillments for ILP Prepare packets. Throws `PaymentError.InvalidCredentials` if the shared secret is not a 32 byte buffer.

Also requires `destinationAddress`.

##### `amountToSend`

> _Optional_: [`BigNumber`](https://mikemcl.github.io/bignumber.js/), `string`, or `number`

Fixed amount to send to the recipient, in the sending asset. Use normal units with arbitrary precision, such as `'1.34'` to represent $1.34 with asset scale 2.

Throws `PaymentError.InvalidSourceAmount` if the amount is invalid (`NaN`, `Infinity`, `0` or negative) or the amount is more precise than the number of decimal places supported by the sending account.

One of `amountToSend` or `amountToDeliver` must be provided, or a `PaymentError.UnknownPaymentTarget` will be thrown.

##### `amountToDeliver`

> _Optional_: [`BigNumber`](https://mikemcl.github.io/bignumber.js/), `string`, or `number`

Fixed amount to deliver to the recipient, in the destination asset. Use normal units with arbitrary precision, such as `'1.34'` to represent $1.34 with asset scale 2.

Throws `PaymentError.InvalidDestinationAmount` if the amount is invalid (`NaN`, `Infinity`, `0` or negative) or the amount is more precise than the number of decimal places supported by the destination account.

One of `amountToSend` or `amountToDeliver` must be provided, or throws `PaymentError.UnknownPaymentTarget`.

##### `destinationAssetCode`

> _Optional_: `string`

Asset code or symbol identifying the asset the recipient will receive. For example: `USD`, `JPY`, `BTC`.

Required if `amountToDeliver` was also provided, or throws `PaymentError.UnknownDestinationAsset`, since the denomination of the payment must always be known in advance. For fixed source amount payments, the destination asset details will be fetched automatically from the recipient using STREAM.

##### `destinationAssetScale`

> _Optional_: `number`

The precision of the recipient's asset denomination: the number of decimal places of the normal unit of the destination asset. For example, if the destination account is denominated in units of $0.01, the asset scale is 2, since the unit is 2 orders of magnitude smaller than 1 U.S. dollar. The asset scale must be an integer between 0 and 255.

Required if `amountToDeliver` was also provided, or throws `PaymentError.UnknownDestinationAsset`.

##### `slippage`

> _Optional_: `number`

Percentage to subtract from the external exchange rate to determine the minimum acceptable exchange rate for each packet. By default, `0.01` or 1% slippage below the external exchange rate (see below) is used.

Throws `PaymentError.InvalidSlippage` if the slippage is not a number between `0` and `1`, or is `NaN`.

##### `prices`

> _Optional_: `{ [assetCode: string]: number }`

Object of asset codes to prices in a standardized base asset to compute exchange rates. For example, here's prices using U.S. dollars as a base asset:

```js
{
  USD: 1,
  EUR: 1.09,
  BTC: 8806.94
}
```

If `prices` is not provided, rates are pulled from the [CoinCap API](https://docs.coincap.io/?version=latest) by default, which provides over 200 fiat and crypto currency prices. A `PaymentError.ExternalRateUnavailable` will be thrown if the exchange rate between the source and destination asset is unavailable from the API or wasn't provided in `prices`.

##### `getExpiry`

> _Optional_: `(destination: string) => Date`

Callback function to set the expiration timestamp of each ILP Prepare packet. By default, the expiration is set to 30 seconds in the future.

#### `Quote`

Parameters of payment execution and the projected outcome of a payment

##### `maxSourceAmount`

> [`BigNumber`](https://mikemcl.github.io/bignumber.js/)

Maximum amount that will be sent in the asset and units of the sending account. This is intended to be presented to the user or agent before authorizing a fixed delivery payment. For fixed source amount payments, this will be the provided `amountToSend`.

##### `estimatedExchangeRate`

> [[`BigNumber`](https://mikemcl.github.io/bignumber.js/), [`BigNumber`](https://mikemcl.github.io/bignumber.js/)]

Probed exchange rate over the path. Range of [lower bound, upper bound], where the rate represents the ratio of the destination amount to the source amount.

##### `minExchangeRate`

> [`BigNumber`](https://mikemcl.github.io/bignumber.js/)

Minimum exchange rate

##### `sourceAccount.ilpAddress`

> `string`

Interledger address of the sender.

##### `sourceAccount.assetScale`

> `number`

The precision of the sending asset denomination: the number of decimal places of the normal unit of the source asset.

##### `sourceAccount.assetCode`

> `string`

Asset code or symbol identifying the asset of the sender.

##### `destinationAccount.ilpAddress`

> `string`

Interledger address of the recipient, identifying this connection.

##### `destinationAccount.assetScale`

> `number`

The precision of the recipient's asset denomination: the number of decimal places of the normal unit of the destination asset.

##### `destinationAccount.assetCode`

> `string`

Asset code or symbol identifying the asset the recipient received.

#### `Receipt`

Final outcome of a payment

##### `error`

> `PaymentError` or `undefined`

Type of error if the payment encountered with an error.

##### `amountSent`

> [`BigNumber`](https://mikemcl.github.io/bignumber.js/)

Amount sent and fulfilled, in normal units of the source asset.

##### `amountInFlight`

> [`BigNumber`](https://mikemcl.github.io/bignumber.js/)

Amount in-flight and yet to be fulfilled or rejected, in normal units of the source asset. (This should always be 0 since no receipt is returned until all pending requests complete).

##### `amountDelivered`

> [`BigNumber`](https://mikemcl.github.io/bignumber.js/)

Amount delivered to the recipient, in normal units of the destination asset.

##### `sourceAccount.ilpAddress`

> `string`

Interledger address of the sender.

##### `sourceAccount.assetScale`

> `number`

The precision of the sending asset denomination: the number of decimal places of the normal unit of the source asset.

##### `sourceAccount.assetCode`

> `string`

Asset code or symbol identifying the asset of the sender.

##### `destinationAccount.ilpAddress`

> `string`

Interledger address of the recipient, identifying this connection.

##### `destinationAccount.assetScale`

> `number`

The precision of the recipient's asset denomination: the number of decimal places of the normal unit of the destination asset.

##### `destinationAccount.assetCode`

> `string`

Asset code or symbol identifying the asset the recipient received.

#### `PaymentError`

> Enum

Payment error states

##### Errors likely caused by the library user

Variant | Description
---|---
`InvalidPaymentPointer` | Payment pointer is formatted incorrectly
`InvalidCredentials` | STREAM credentials (shared secret and destination address) were not provided or invalid
`Disconnected` | Plugin failed to connect or is disconnected from the Interleder network
`InvalidSlippage` | Slippage percentage is not between 0 and 1 (inclusive)
`IncompatibleIntegerledgerNetworks` | Sender and receiver use incompatible Interledger network prefixes
`UnknownSourceAsset` | Failed to fetch IL-DCP details for the source account: unknown sending asset or ILP address
`UnknownPaymentTarget` | No fixed source amount or fixed destination amount was provided
`InvalidSourceAmount` | Fixed source amount is invalid or too precise for the source account
`InvalidDestinationAmount` | Fixed delivery amount is invalid or too precise for the destination account

##### Errors liked caused by the receiver, connectors, or other externalities

Variant | Description
---|---
`SpspQueryFailed` | Failed to query the SPSP server or received an invalid response
`ExternalRateUnavailable` | Failed to fetch the external exchange rate and unable to enforce a minimum exchange rate
`InsufficientExchangeRate` | Probed exchange rate is too low: less than the minimum pulled from external rate APIs
`UnknownDestinationAsset` | Destination asset details are unknown or the receiver never provided them
`DestinationAssetConflict` | Receiver sent conflicting destination asset details
`IncompatibleReceiveMax` | Receiver's advertised limit is incompatible with the amount we want to send or deliver to them
`ClosedByRecipient` | The recipient closed the connection or stream, terminating the payment

##### Miscellaneous errors

Variant | Description
---|---
`RateProbeFailed` | Rate probe failed to establish the realized exchange rate
`OverpaidFixedSend` | Send more than intended: paid more than the fixed source amount of the payment
`IdleTimeout` | Failed to fulfill a packet before payment timed out
`TerminalReject` | Encountered an ILP Reject packet with a final error that cannot be retried
`ExceededMaxSequence` | Sent too many packets with this encryption key and must close the connection
