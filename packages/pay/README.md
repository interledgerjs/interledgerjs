## `@interledger/pay` :money_with_wings:

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

TODO Add section to this explaining amounts & `Int`

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

#### Send money to a Payment Pointer

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

#### Amounts

TODO explain

#### Rates

TODO explain

#### Error Handling

TODO update this example

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

Quote and prepare to perform a payment:

- Query the recipient's payment pointer or invoice to setup the payment
- Fetch the asset and details of the sending account
- Ensure there's a viable payment path to the recipient
- Probe the realized exchange rate to the recipient
- Enforce minimum exchange rates by comparing against rates pulled from external sources, and compute a maximum amount that will be sent

After the quote is complete, the consumer will have the option to execute or cancel the payment.

If the quote fails, the returned Promise will reject with a [`PaymentError`](#paymenterror) variant.

#### `SetupOptions`

> Interface

Parameters to setup and resolve payment details from the recipient.

##### `plugin`

> [`Plugin`](https://github.com/interledger/rfcs/blob/master/deprecated/0024-ledger-plugin-interface-2/0024-ledger-plugin-interface-2.md)

Plugin to send packets over a connected Interledger network.

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

Perform a rate probe to ensure the recipient is routable, discover the path max packet size, probe the realized exchange rate, and compute the bounds of the payment.

##### `close`

> () => Promise<void>

Close the connection, if it was established, and disconnect the plugin.

##### `destinationAddress`

> `string`

ILP address of the destination STREAM recipient, identifying this connection

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

| Variant                        | Description                                                             |
| :----------------------------- | :---------------------------------------------------------------------- |
| **`InvalidPaymentPointer`**    | Payment pointer is formatted incorrectly                                |
| **`InvalidCredentials`**       | No valid STREAM credentials or URL to fetch them was provided           |
| **`Disconnected`**             | Plugin failed to connect or is disconnected from the Interleder network |
| **`InvalidSlippage`**          | Slippage percentage is not between 0 and 1 (inclusive)                  |
| **`UnknownSourceAsset`**       | Source asset or denomination was not provided                           |
| **`UnknownPaymentTarget`**     | No fixed source amount or fixed destination amount was provided         |
| **`InvalidSourceAmount`**      | Fixed source amount is not a positive integer                           |
| **`InvalidDestinationAmount`** | Fixed delivery amount is not a positive integer                         |
| **`UnenforceableDelivery`**    | Minimum exchange rate of 0 cannot enforce a fixed-delivery payment      |

##### Errors likely caused by the receiver, connectors, or other externalities

| Variant                         | Description                                                                                |
| :------------------------------ | :----------------------------------------------------------------------------------------- |
| **`QueryFailed`**               | Failed to query the Open Payments or SPSP server, or received an invalid response          |
| **`InvoiceAlreadyPaid`**        | Invoice was already fully paid or overpaid, so no payment is necessary                     |
| **`ConnectorError`**            | Cannot send over this path due to an ILP Reject error                                      |
| **`EstablishmentFailed`**       | No authentic reply from receiver, packets may not have been delivered                      |
| **`UnknownDestinationAsset`**   | Destination asset details are unknown or the receiver never provided them                  |
| **`DestinationAssetConflict`**  | Receiver sent conflicting destination asset details                                        |
| **`ExternalRateUnavailable`**   | Failed to compute a minimum exchange rate                                                  |
| **`RateProbeFailed`**           | Rate probe failed to establish the exchange rate or discover path max packet amount        |
| **`InsufficientExchangeRate`**  | Real exchange rate is less than minimum exchange rate with slippage                        |
| **`ExchangeRateRoundingError`** | Exchange rate is too close to minimum to deliver max packet amount without rounding errors |
| **`IdleTimeout`**               | No packets were fulfilled within timeout                                                   |
| **`ClosedByRecipient`**         | The recipient closed the connection or stream, terminating the payment                     |
| **`IncompatibleReceiveMax`**    | Receiver's advertised limit is incompatible with the amount we may deliver                 |
| **`ReceiverProtocolViolation`** | Receiver violated the STREAM protocol, misrepresenting delivered amounts                   |
| **`ExceededMaxSequence`**       | Encrypted maximum number of packets using the key for this connection                      |
