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

TODO Add section to this explaining amounts, scales & `Int`

#### Flow

1. Call `setupPayment` to resolve the payment details, destination asset, and/or invoice
1. Add custom logic before continuing, or catch error
1. Call `quote` to probe the exchange rate, discover the max packet amount, and compute payment limits
1. Add custom logic to authorize payment for maxiumum source amount, or catch error
1. Call `pay` to execute the payment
1. Add custom logic based on payment outcome, or catch error

#### Pay an invoice

> Fixed delivery amount payment

```js
import { quote } from '@interledger/pay'

async function run() {
  const { quote } = await setupPayment({
    plugin: new Plugin(),
    invoiceUrl: 'https://mywallet.com/accounts/alice/invoices/04ef492f-94af-488e-8808-3ea95685c992',
  })

  const { pay, close, ...details } = await quote({
    sourceAsset: {
      assetCode: 'USD',
      assetScale: 9,
    },
  })
  // {
  //   maxSourceAmount: Int(0.000198),
  //   estimatedExchangeRate: [1.2339, 1.23423],
  //   minExchangeRate: 1.21,
  // }

  // Choose to execute the payment...
  const receipt = await pay()
  console.log(receipt)
  // {
  //    amountSent: Int(0.000191),
  //    amountDelivered: Int(0.0234),
  //    ...
  // }

  // ...or decline: disconnect and close the connection
  await close()
}
```

#### Pay to [payment pointer](https://paymentpointers.org/)

> Fixed source amount payment

```js
import { setupPayment } from '@interledger/pay'

async function run() {
  const { quote } = await setupPayment({
    plugin: new Plugin(),
    paymentPointer: '$rafiki.money/p/example',
  })

  const { pay } = await quote({
    amountToSend: '314159',
    sourceAmount: {
      assetCode: 'EUR',
      assetScale: 6,
    },
  })

  const receipt = await pay()
}
```

> Fixed delivery amount payment

```js
import { setupPayment } from '@interledger/pay'

async function run() {
  const { quote, destinationAsset } = await setupPayment({
    plugin: new Plugin(),
    paymentPointer: '$rafiki.money/p/example',
  })

  // Check to ensure the destination asset and denomination is correct

  const { pay, close, maxSourceAmount } = await quote({
    amountToDeliver: 40_000,
    sourceAsset: {
      assetCode: 'ABC',
      assetScale: 4,
    },
  })

  // Verify the max source amount is approriate and perform or cancel the payment

  const receipt = await pay()
}
```

#### Units

On Interledger assets and denominations, from the [Settlement Engines RFC](https://interledger.org/rfcs/0038-settlement-engines/#units-and-quantities):

> Asset amounts may be represented using any arbitrary denomination. For example, one U.S. dollar may be represented as \$1 or 100 cents, each of which is equivalent in value. Likewise, one Bitcoin may be represented as 1 BTC or 100,000,000 satoshis.
>
> A **standard unit** is the typical unit of value for a particular asset, such as \$1 in the case of U.S. dollars, or 1 BTC in the case of Bitcoin.
>
> A **fractional unit** represents some unit smaller than the standard unit, but with greater precision. Examples of fractional monetary units include one cent (\$0.01 USD), or 1 satoshi (0.00000001 BTC).
>
> An **asset scale** is the difference in orders of magnitude between the standard unit and a corresponding fractional unit. More formally, the asset scale is a non-negative integer (0, 1, 2, …) such that one standard unit equals the value of `10^(scale)` corresponding fractional units. If the fractional unit equals the standard unit, then the asset scale is 0.
>
> For example, one cent represents an asset scale of 2 in the case of USD, whereas one satoshi represents an asset scale of 8 in the case of Bitcoin.

To simplify accounting, all amounts are represented as unsigned integers in a fractional unit of the asset corresponding to the source asset scale provided, or the destination asset scale resolved from the receiver.

Since applications need to debit the source amount in their own system before executing a payment, this assumes they also know their own source asset and denomination. Therefore, it's not useful to resolve this information dynamically, such as using [IL-DCP](https://interledger.org/rfcs/0031-dynamic-configuration-protocol/), which also delays connection establishment.

#### Amounts

`pay` leverages JavaScript [`BigInt`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt)s for arbitrarily large integers, exporting its own wrapper for strongly typed arithmetic operations.

All amounts returned by `pay` use these exported classes and interfaces:

- [`Int`](https://github.com/interledgerjs/interledgerjs/blob/master/packages/pay/src/utils.ts#L24) &mdash; Class representing non-negative integers.
- [`PostiiveInt`](https://github.com/interledgerjs/interledgerjs/blob/master/packages/pay/src/utils.ts#L180) &mdash; Interface narrowing `Int`, representing non-negative, non-zero integers. (In this context, zero is not considered signed).
- [`Ratio`](https://github.com/interledgerjs/interledgerjs/blob/master/packages/pay/src/utils.ts#L221) &mdash; Class representing a ratio of two integers: a non-negative numerator, and a non-negative, non-zero denominator.
- [`PositiveRatio`](https://github.com/interledgerjs/interledgerjs/blob/master/packages/pay/src/utils.ts#L306) &mdash; Interface narrowing `Ratio`, representing a ratio of two non-negative, non-zero integers.

`Int` and `Ratio` offer utility methods for integer operations and comparisons. They may also be converted to/from `number`, `string`, `bigint`, and [`Long`](https://github.com/dcodeIO/Long.js/).

`Int` and `Ratio` enforce handling of all divide-by-zero errors and the internal `bigint` is always non-negative. They also provide type guards for `PositiveInt` to reduce unnecessary code paths. For example, if one integer is greater than another, that integer must always be non-zero, and can be safely used as a ratio denominator without any divide-by-zero branch.

#### Exchange Rates

`pay` is designed to provide strong guarantees of the amount that will be delivered.

During the `quote` step, the application provides `pay` with prices for the source and destination assets and it's own acceptable slippage percentage, which `pay` uses to calculate a minimum exchange rate and corresponding minimum destination amount it will enforce for the payment. Exchange rates are also defined in terms of the ratio between a destination amount and a source amount, in fractional units.

Then, `pay` probes the recipient to determine the real exchange rate over that path. If it sufficiently exceeds the minimum exchange rate, `pay` will allow the payment to proceed. Otherwise, it's not possible to complete the payment. For instance, connectors may have applied a poor rate or charged too much in fees, the max packet size might be too small to avoid rounding errors, or incorrect assets/scales were provided.

Since STREAM payments are packetized, `pay` cannot prevent partial completion, but guarantees payments will never exhaust their quoted maximum source amount without already satisfying their quoted minimum delivery amount. Every\* delivered packet meets or exceeds the quoted minimum exchange rate.

#### Error Handling

If setup or quoting fails, it will reject the Promise with a variant of the [`PaymentError`](#paymenterror) enum. For example:

```js
import { setupPayment, PaymentError } from '@interledger/pay'

try {
  await setupPayment({ ... })
} catch (err) {
  if (err === PaymentError.InvalidPaymentPointer) {
    console.log('Payment pointer is invalid!')
  }

  // ...
}
```

Similarly, if an error was encountered during the payment itself, it will include an `error` property on the receipt which is a [`PaymentError`](#paymenterror) variant.

### API

#### `setupPayment`

> `(options: SetupOptions) => Promise<PaymentDetails>`

TODO: Update this description

#### `SetupOptions`

> Interface

Parameters to setup and resolve payment details from the recipient.

##### `plugin`

> [`Plugin`](https://github.com/interledger/rfcs/blob/master/deprecated/0024-ledger-plugin-interface-2/0024-ledger-plugin-interface-2.md)

Plugin to send packets over a connected Interledger network (no receive functionality is necessary). Pay does not call `connect` or `disconnect` on the plugin, so the user must perform that manually.

##### `paymentPointer`

> _Optional_: `string`

Payment pointer, [Open Payments account URL](https://docs.openpayments.dev/accounts), or SPSP account URL to query STREAM connection credentials and exchange asset details. Automatically falls back to using SPSP if the server doesn't support Open Payments. Example: `$rafiki.money/p/alice`. Either **[`paymentPointer`](#paymentpointer)** or **[`invoiceUrl`](#invoiceurl)** must be provided.

##### `invoiceUrl`

> _Optional_: `string`

[Open Payments invoice URL](https://docs.openpayments.dev/invoices) to query the details for a fixed-delivery payment. The amount to deliver and destination asset details will automatically be resolved from the invoice.

#### `ResolvedPayment`

> Interface

Resolved destination details of a proposed payment.

##### `quote`

> (options: QuoteOptions) => Promise<Quote>

Perform a rate probe:

- Ensure the recipient is routable
- Discover the path max packet size
- Probe the real exchange rate
- compute the minimum exchange rate adn bounds of the payment

##### `close`

> () => Promise<void>

Close the connection, if it was established, and disconnect the plugin.

##### `destinationAddress`

> `string` (`IlpAddress` type from `[ilp-packet](../ilp-packet)`)

ILP address of the destination STREAM recipient, uniquely identifying this connection

##### `destinationAsset`

> **[`AssetDetails`](#assetdetails)**

Destination asset and denomination, resolved using Open Payments or STREAM.

##### `invoice`

> _Optional_: **[`Invoice`](#invoice)**

Open Payments invoice metadata, if the payment pays into an invoice.

#### `PayOptions`

> Interface

Parameters to setup and prepare a payment

##### `sourceAsset`

> **[`AssetDetails`](#assetdetails)**

Source asset and denomination for the sender. Required to compute the minimum exchange rate.

##### `amountToSend`

> _Optional_: `string`, `number`, `bigint` or **[`Int`](#)**

Fixed amount to send to the recipient, in base units of the sending asset. Either **[`amountToSend`](#amounttosend)**, **[`amountToDeliver`](#amounttodeliver)**, or **[`invoiceUrl`](#invoiceurl)** must be provided, in order to determine how much to pay.

##### `amountToDeliver`

> _Optional_: `string`, `number`, `bigint`, or **[`Int`](#)**

Fixed amount to deliver to the recipient, in base units of the destination asset. **[`invoiceUrl`](#invoiceurl)** is recommended to send fixed delivery payments, but this option enables sending a fixed-delivery payment to an SPSP server that doesn't support Open Payments.

Note: this option requires the destination asset to be known in advance. The application must check to ensure the destination asset resolved via STREAM is the expected asset and denomination.

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

If the source and destination assets are the same, a 1:1 rate will be used as the basis, so **[`prices`](#prices)** doesn't need to be provided. It may also be omitted if the slippage is set to 100%, since no minimum exchange rates will be enforced.

##### `slippage`

> _Optional_: `number`

Percentage to subtract from the external exchange rate to determine the minimum acceptable exchange rate and destination amount for each packet, between `0` and `1` (inclusive). Defaults to `0.01`, or 1% slippage below the exchange rate computed from the given **[`prices`](#prices)**.

If `1` is provided for a fixed source amount payment, no minimum exchange rate will be enforced. For fixed delivery payments, slippage cannot be 100%.

#### `AssetDetails`

> Interface

Asset and denominated for an Interledger account (source or destination asset)

| Property         | Type     | Description                                                                         |
| :--------------- | :------- | :---------------------------------------------------------------------------------- |
| **`assetScale`** | `number` | Precision of the asset denomination: number of decimal places of the ordinary unit. |
| **`assetCode`**  | `string` | Asset code or symbol identifying the currency of the account.                       |

#### `Quote`

> Interface

Parameters of payment execution and the projected outcome of a payment

TODO update `pay` signature with handler

| Property                    | Type                                                                                              | Description                                                                                                                                                                                                                                                                                    |
| :-------------------------- | :------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`pay`**                   | `(options?: { progressHandler: (receipt: Receipt) => void }) => Promise<`[`Receipt`](#receipt)`>` | Execute the payment within these limits.                                                                                                                                                                                                                                                       |
| **`close`**                 | `() => Promise<void>`                                                                             | Cancel the payment: disconnect plugin and closes connection with recipient.                                                                                                                                                                                                                    |
| **`maxSourceAmount`**       | **[`Int`](#)**                                                                                    | Maximum amount that will be sent in the base unit and asset of the sending account. This is intended to be presented to the user or agent before authorizing a fixed delivery payment. For fixed source amount payments, this will be the provided **[`amountToSend`](#amounttosend)**.        |
| **`minDeliveryAmount`**     | **[`Int`](#)**                                                                                    | Minimum amount that will be delivered if the payment completes, in the base unit and asset of the receiving account. For fixed delivery payments, this will be the provided **[`amountToDeliver`](#amounttodeliver)** or amount of the invoice.                                                |
| **`maxPacketAmount`**       | **[`Int`](#)**                                                                                    | Discovered maximum packet amount allowed over this payment path.                                                                                                                                                                                                                               |
| **`estimatedExchangeRate`** | `[number, number]`                                                                                | Probed exchange rate over the path. Range of [lower bound, upper bound], where the rate represents the ratio of the destination amount to the source amount. Due to varying packet amounts, rounding, and rate fluctuations, this may not represent the aggregate rate of the payment.         |
| **`minExchangeRate`**       | `number`                                                                                          | Aggregate exchange rate the payment is guaranteed to meet, less 1 unit of the source asset. Corresponds to the minimum exchange rate enforced on each packet (\*except for the final packet) to ensure sufficient money gets delivered. For strict bookkeeping, use `maxSourceAmount` instead. |
| **`estimatedDuration`**     | `number`                                                                                          | Estimated payment duration in milliseconds, based on max packet amount, round trip time, and rate of packet throttling.                                                                                                                                                                        |

#### `Invoice`

> Interface

[Open Payments invoice](https://docs.openpayments.dev/invoices) metadata

| Property              | Type           | Description                                                                                            |
| :-------------------- | :------------- | :----------------------------------------------------------------------------------------------------- |
| **`invoiceUrl`**      | `string`       | URL identifying the invoice.                                                                           |
| **`accountUrl`**      | `string`       | URL identifying the account into which payments toward the invoice will be credited.                   |
| **`amountToDeliver`** | **[`Int`](#)** | Fixed destination amount that must be delivered to complete payment of the invoice, in ordinary units. |
| **`amountDelivered`** | **[`Int`](#)** | Amount that has already been paid toward the invoice, in ordinary units.                               |
| **`assetScale`**      | `number`       | Precision of the recipient's asset denomination: number of decimal places of the ordinary unit.        |
| **`assetCode`**       | `string`       | Asset code or symbol identifying the currency of the destination account.                              |
| **`expiresAt`**       | `number`       | UNIX timestamp in milliseconds after which payments toward the invoice will no longer be accepted.     |
| **`description`**     | `string`       | Human-readable description of what is provided in return for completion of the invoice.                |

#### `Receipt`

TODO Rename this to, e.g., `PaymentStatus`? Then it could be streaming updates. Or could stream updates be through another mechanism?

> Interface

TODO improve description? status? accounting?
TODO add in-flight amounts here

Final outcome of a payment

| Property                         | Type                                | Description                                                                                                                      |
| :------------------------------- | :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| **`error`** (_Optional_)         | **[`PaymentError`](#paymenterror)** | Error state, if the payment failed.                                                                                              |
| **`amountSent`**                 | **[`Int`](#)**                      | Amount sent and fulfilled, in normal units of the source asset.                                                                  |
| **`amountDelivered`**            | **[`Int`](#)**                      | Amount delivered to the recipient, in normal units of the destination asset.                                                     |
| **`streamReceipt`** (_Optional_) | `Buffer`                            | Latest [STREAM receipt](https://interledger.org/rfcs/0039-stream-receipts/) to provide proof-of-delivery to a 3rd party verifier |

#### `PaymentError`

> String enum

Payment error states

##### Errors likely caused by the user

| Variant                        | Description                                                        |
| :----------------------------- | :----------------------------------------------------------------- |
| **`InvalidPaymentPointer`**    | Payment pointer is formatted incorrectly                           |
| **`InvalidCredentials`**       | No valid STREAM credentials or URL to fetch them was provided      |
| **`InvalidSlippage`**          | Slippage percentage is not between 0 and 1 (inclusive)             |
| **`UnknownSourceAsset`**       | Source asset or denomination was not provided                      |
| **`UnknownPaymentTarget`**     | No fixed source amount or fixed destination amount was provided    |
| **`InvalidSourceAmount`**      | Fixed source amount is not a positive integer                      |
| **`InvalidDestinationAmount`** | Fixed delivery amount is not a positive integer                    |
| **`UnenforceableDelivery`**    | Minimum exchange rate of 0 cannot enforce a fixed-delivery payment |

##### Errors likely caused by the receiver, connectors, or other externalities

| Variant                         | Description                                                                                |
| :------------------------------ | :----------------------------------------------------------------------------------------- |
| **`QueryFailed`**               | Failed to query the Open Payments or SPSP server, or received an invalid response          |
| **`InvoiceAlreadyPaid`**        | Invoice was already fully paid or overpaid, so no payment is necessary                     |
| **`ConnectorError`**            | Cannot send over this path due to an ILP Reject error                                      |
| **`EstablishmentFailed`**       | No authentic reply from receiver: packets may not have been delivered                      |
| **`UnknownDestinationAsset`**   | Destination asset details are unknown or the receiver never provided them                  |
| **`DestinationAssetConflict`**  | Receiver sent conflicting destination asset details                                        |
| **`ExternalRateUnavailable`**   | Failed to compute a minimum exchange rate                                                  |
| **`RateProbeFailed`**           | Rate probe failed to establish the exchange rate or discover path max packet amount        |
| **`InsufficientExchangeRate`**  | Real exchange rate is less than minimum exchange rate with slippage                        |
| **`ExchangeRateRoundingError`** | Exchange rate is too close to minimum to deliver max packet amount without rounding errors |
| **`IdleTimeout`**               | No packets were fulfilled within timeout                                                   |
| **`ClosedByReceiver`**          | Receiver closed the connection or stream, terminating the payment                          |
| **`IncompatibleReceiveMax`**    | Estimated destination amount exceeds the receiver's limit                                  |
| **`ReceiverProtocolViolation`** | Receiver violated the STREAM protocol, misrepresenting delivered amounts                   |
| **`ExceededMaxSequence`**       | Encrypted maximum number of packets using the key for this connection                      |
