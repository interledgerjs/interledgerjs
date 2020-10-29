## `pay` :money_with_wings:

> Send payments over Interledger using STREAM

[![NPM Package](https://img.shields.io/npm/v/@interledger/pay.svg?style=flat&logo=npm)](https://npmjs.org/package/@interledger/pay)
[![GitHub Actions](https://img.shields.io/github/workflow/status/interledgerjs/interledgerjs/master.svg?style=flat&logo=github)](https://github.com/interledgerjs/interledgerjs/actions?query=workflow%3Amaster)
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

### Guide

#### Pay an invoice

> Fixed delivery amount payment

```js
import { quote } from '@interledger/pay'

async function run() {
  const { pay, cancel, ...details } = await quote({
    plugin: new Plugin(),
    invoiceUrl: 'https://mywallet.com/accounts/alice/invoices/04ef492f-94af-488e-8808-3ea95685c992',
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
  //    amountDelivered: BigNumber(0.0234),
  //    ...
  // }

  // ...or decline: disconnect and close the connection
  await cancel()
}
```

#### Send money to a Payment Pointer

> Fixed source amount payment

```js
import { quote } from '@interledger/pay'

async function run() {
  const { pay, ...details } = await quote({
    plugin: new Plugin(...),
    paymentPointer: '$rafiki.money/p/example',
    amountToSend: '3.14159',
  })

  const receipt = await pay()
}
```

#### Error Handling

If quoting fails, it will reject the Promise with a variant of the [`PaymentError`](#paymenterror) enum. For example:

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

Similarly, if an error was encountered during the payment itself, it will include an `error` property on the receipt which is a [`PaymentError`](#paymenterror) variant.

### API

#### `quote`

> `(options:`[`PaymentOptions`](#paymentoptions)`) => Promise<`[`Quote`](#quote-1)`>`

Quote and prepare to perform a payment:

- Query the recipient's payment pointer or invoice to setup the payment
- Fetch the asset and details of the sending account
- Ensure there's a viable payment path to the recipient
- Probe the realized exchange rate to the recipient
- Enforce minimum exchange rates by comparing against rates pulled from external sources, and compute a maximum amount that will be sent

After the quote is complete, the consumer will have the option to execute or cancel the payment.

If the quote fails, the returned Promise will reject with a [`PaymentError`](#paymenterror) variant.

#### `PaymentOptions`

> Interface

Parameters to setup and prepare a payment

##### `plugin`

> [`Plugin`](https://github.com/interledger/rfcs/blob/master/deprecated/0024-ledger-plugin-interface-2/0024-ledger-plugin-interface-2.md)

Plugin to send and receive packets over a connected Interledger network.

##### `paymentPointer`

> _Optional_: `string`

Payment pointer, [Open Payments account URL](https://docs.openpayments.dev/accounts), or SPSP account URL to query STREAM connection credentials and exchange asset details. Automatically falls back to using SPSP if the server doesn't support Open Payments. Example: `$rafiki.money/p/alice`. Either **[`paymentPointer`](#paymentpointer)** or **[`invoiceUrl`](#invoiceurl)** must be provided.

##### `invoiceUrl`

> _Optional_: `string`

[Open Payments invoice URL](https://docs.openpayments.dev/invoices) to query the details for a fixed-delivery payment. The amount to deliver and destination asset details will automatically be resolved from the invoice.

##### `amountToSend`

> _Optional_: [`BigNumber`](https://mikemcl.github.io/bignumber.js/), `string`, or `number`

Fixed amount to send to the recipient, in the sending asset. Use normal units with arbitrary precision, such as `1.34` to represent \$1.34 with asset scale 2. This must be a positive integer with no more decimal places than the asset scale of the sending account. Either **[`amountToSend`](#amounttosend)** or **[`invoiceUrl`](#invoiceurl)** must be provided, in order to determine how much to pay.

##### `slippage`

> _Optional_: `number`

Percentage to subtract from the external exchange rate to determine the minimum acceptable exchange rate for each packet, between `0` and `1` (inclusive). By default, `0.01` or 1% slippage below the external exchange rate (see below) is used.

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

If **[`prices`](#prices)** was not provided, rates are pulled from the [CoinCap API](https://docs.coincap.io/?version=latest) by default, which provides over 200 fiat and crypto currency prices.

##### `getExpiry`

> _Optional_: `(destination?: string) => Date`

Callback function to set the expiration timestamp of each ILP Prepare packet. By default, the expiration is set to 30 seconds in the future.

##### `amountToDeliver`

> _Optional_: `Int`

_For testing purposes_. **[`invoiceUrl`](#invoiceurl)** is recommended to send fixed delivery payments.

Fixed amount to deliver to the recipient, in base units of the destination asset.

##### `destinationAddress`

> _Optional_: `string`

_For testing purposes_. **[`invoiceUrl`](#invoiceurl)** or **[`paymentPointer`](#paymentpointer)** is recommended to exchange these credentials.

ILP address of the recipient, identifying this connection, which is used to send packets to their STREAM server. Also requires **[`sharedSecret`](#sharedsecret)**.

##### `sharedSecret`

> _Optional_: `Buffer`

_For testing purposes_. **[`invoiceUrl`](#invoiceurl)** or **[`paymentPointer`](#paymentpointer)** is recommended to exchange these credentials.

32-byte symmetric key shared between the sender and recipient to encrypt and decrypt STREAM messages, and generate fulfillments for ILP Prepare packets. Also requires **[`destinationAddress`](#destinationaddress)**.

#### `AccountDetails`

> Interface

Asset and Interledger address for an account (sender or receiver)

| Property         | Type     | Description                                                                         |
| :--------------- | :------- | :---------------------------------------------------------------------------------- |
| **`ilpAddress`** | `string` | Interledger address of the account.                                                 |
| **`assetScale`** | `number` | Precision of the asset denomination: number of decimal places of the ordinary unit. |
| **`assetCode`**  | `string` | Asset code or symbol identifying the currency of the account.                       |

#### `Quote`

> Interface

Parameters of payment execution and the projected outcome of a payment

| Property                    | Type                                                                                                             | Description                                                                                                                                                                                                                                                                                 |
| :-------------------------- | :--------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`pay`**                   | `() => Promise<`[`Receipt`](#receipt)`>`                                                                         | Execute the payment within these parameters.                                                                                                                                                                                                                                                |
| **`cancel`**                | `() => Promise<void>`                                                                                            | Cancel the payment: disconnect plugin and closes connection with recipient.                                                                                                                                                                                                                 |
| **`maxSourceAmount`**       | [`BigNumber`](https://mikemcl.github.io/bignumber.js/)                                                           | Maximum amount that will be sent in the asset and units of the sending account. This is intended to be presented to the user or agent before authorizing a fixed delivery payment. For fixed source amount payments, this will be the provided **[`amountToSend`](#amounttosend)**.         |
| **`minDeliveryAmount`**     | [`BigNumber`](https://mikemcl.github.io/bignumber.js/)                                                           | Minimum amount that will be delivered if the payment completes, in the asset and units of the receiving account. For fixed delivery payments, this will be the provided **[`amountToDeliver`](#amounttodeliver)** or amount of the invoice.                                                 |
| **`estimatedExchangeRate`** | [[`BigNumber`](https://mikemcl.github.io/bignumber.js/), [`BigNumber`](https://mikemcl.github.io/bignumber.js/)] | Probed exchange rate over the path. Range of [lower bound, upper bound], where the rate represents the ratio of the destination amount to the source amount. Due to varying packet amounts, rounding, and rate fluctuations, this may not represent the aggregate rate of the payment.      |
| **`minExchangeRate`**       | [`BigNumber`](https://mikemcl.github.io/bignumber.js/)                                                           | Aggregate exchange rate the payment is guaranteed to meet, less 1 unit of the source asset. Corresponds to the minimum exchange rate enforced on each packet (\*except for the final packet) to ensure sufficient money gets delivered. For strict bookkeeping, defer to `maxSourceAmount`. |
| **`estimatedDuration`**     | `number`                                                                                                         | Estimated payment duration in milliseconds, based on max packet amount, round trip time, and rate of packet throttling.                                                                                                                                                                     |
| **`sourceAccount`**         | [`AccountDetails`](#accountdetails)                                                                              | Asset and details of the sender's Interledger account                                                                                                                                                                                                                                       |
| **`destinationAccount`**    | [`AccountDetails`](#accountdetails)                                                                              | Asset and details of the recipient's Interledger account                                                                                                                                                                                                                                    |
| **`invoice`** (_Optional_)  | [`Invoice`](#invoice)                                                                                            | Open Payments invoice metadata, if the payment pays into an invoice                                                                                                                                                                                                                         |

#### `Invoice`

> Interface

[Open Payments invoice](https://docs.openpayments.dev/invoices) metadata

| Property              | Type                                                   | Description                                                                                            |
| :-------------------- | :----------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| **`invoiceUrl`**      | `string`                                               | URL identifying the invoice.                                                                           |
| **`accountUrl`**      | `string`                                               | URL identifying the account into which payments toward the invoice will be credited.                   |
| **`amountToDeliver`** | [`BigNumber`](https://mikemcl.github.io/bignumber.js/) | Fixed destination amount that must be delivered to complete payment of the invoice, in ordinary units. |
| **`amountDelivered`** | [`BigNumber`](https://mikemcl.github.io/bignumber.js/) | Amount that has already been paid toward the invoice, in ordinary units.                               |
| **`assetScale`**      | `number`                                               | Precision of the recipient's asset denomination: number of decimal places of the ordinary unit.        |
| **`assetCode`**       | `string`                                               | Asset code or symbol identifying the currency of the destination account.                              |
| **`expiresAt`**       | `number`                                               | UNIX timestamp in milliseconds after which payments toward the invoice will no longer be accepted.     |
| **`description`**     | `string`                                               | Human-readable description of what is provided in return for completion of the invoice.                |

#### `Receipt`

> Interface

Final outcome of a payment

| Property                 | Type                                                   | Description                                                                  |
| :----------------------- | :----------------------------------------------------- | :--------------------------------------------------------------------------- |
| **`error`** (_Optional_) | [`PaymentError`](#paymenterror)                        | Error state, if the payment failed.                                          |
| **`amountSent`**         | [`BigNumber`](https://mikemcl.github.io/bignumber.js/) | Amount sent and fulfilled, in normal units of the source asset.              |
| **`amountDelivered`**    | [`BigNumber`](https://mikemcl.github.io/bignumber.js/) | Amount delivered to the recipient, in normal units of the destination asset. |
| **`sourceAccount`**      | [`AccountDetails`](#accountdetails)                    | Asset and details of the sender's Interledger account                        |
| **`destinationAccount`** | [`AccountDetails`](#accountdetails)                    | Asset and details of the recipient's Interledger account                     |

#### `PaymentError`

> String enum

Payment error states

##### Errors likely caused by the user

| Variant                               | Description                                                                                          |
| :------------------------------------ | :--------------------------------------------------------------------------------------------------- |
| **`InvalidPaymentPointer`**           | Payment pointer is formatted incorrectly                                                             |
| **`InvalidCredentials`**              | STREAM credentials (shared secret and destination address) were not provided or semantically invalid |
| **`Disconnected`**                    | Plugin failed to connect or is disconnected from the Interleder network                              |
| **`InvalidSlippage`**                 | Slippage percentage is not between 0 and 1 (inclusive)                                               |
| **`IncompatibleInterledgerNetworks`** | Sender and receiver use incompatible Interledger networks or address prefixes                        |
| **`UnknownSourceAsset`**              | Failed to fetch IL-DCP details for the source account: unknown sending asset or ILP address          |
| **`UnknownPaymentTarget`**            | No fixed source amount or fixed destination amount was provided                                      |
| **`InvalidSourceAmount`**             | Fixed source amount is not a positive integer or more precise than the source account                |
| **`InvalidDestinationAmount`**        | Fixed delivery amount is not a positive integer or more precise than the destination account         |
| **`UnenforceableDelivery`**           | Minimum exchange rate is 0 after subtracting slippage, and cannot enforce a fixed-delivery payment   |

##### Errors likely caused by the receiver, connectors, or other externalities

| Variant                         | Description                                                                                                                                                            |
| :------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`QueryFailed`**               | Failed to query the Open Payments or SPSP server, or received an invalid response                                                                                      |
| **`InvoiceAlreadyPaid`**        | Invoice was already fully paid or overpaid, so no payment is necessary                                                                                                 |
| **`ExternalRateUnavailable`**   | Failed to fetch the external exchange rate and unable to enforce a minimum exchange rate                                                                               |
| **`InsufficientExchangeRate`**  | Probed exchange rate is too low: less than the minimum pulled from external rate APIs                                                                                  |
| **`UnknownDestinationAsset`**   | Destination asset details are unknown or the receiver never provided them                                                                                              |
| **`DestinationAssetConflict`**  | Receiver sent conflicting destination asset details                                                                                                                    |
| **`IncompatibleReceiveMax`**    | Receiver's advertised limit is incompatible with the amount we want to send or deliver to them                                                                         |
| **`ClosedByRecipient`**         | The recipient closed the connection or stream, terminating the payment                                                                                                 |
| **`ReceiverProtocolViolation`** | Receiver violated the STREAM protocol that prevented accounting for delivered amounts                                                                                  |
| **`RateProbeFailed`**           | Rate probe failed to communicate with the recipient                                                                                                                    |
| **`IdleTimeout`**               | Failed to fulfill a packet before the payment timed out                                                                                                                |
| **`ConnectorError`**            | Encountered an ILP Reject that cannot be retried, or the payment is not possible over this path                                                                        |
| **`ExceededMaxSequence`**       | Sent too many packets with this encryption key and must close the connection                                                                                           |
| **`ExchangeRateRoundingError`** | Rate enforcement not possible due to rounding: max packet amount may be too low, minimum exchange rate may require more slippage, or exchange rate may be insufficient |
