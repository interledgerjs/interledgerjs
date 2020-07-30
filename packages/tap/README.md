## `@interledger/tap` :shower:

> Stream money over Interledger as fast as possible

[![NPM Package](https://img.shields.io/npm/v/@interledger/tap.svg?style=flat&logo=npm)](https://npmjs.org/package/@interledger/tap)
[![GitHub Actions](https://img.shields.io/github/workflow/status/interledgerjs/interledgerjs/master.svg?style=flat&logo=github)](https://github.com/interledgerjs/interledgerjs/actions?query=workflow%3Amaster)
[![Codecov](https://img.shields.io/codecov/c/github/interledgerjs/interledgerjs/master.svg?logo=codecov&flag=tap)](https://codecov.io/gh/interledgerjs/interledgerjs/tree/master/packages/tap/src)
[![Prettier](https://img.shields.io/badge/code_style-prettier-brightgreen.svg)](https://prettier.io/)

## Install

```bash
npm i @interledger/tap
```

Or using Yarn:

```bash
yarn add @interledger/tap
```

## API

### `sendInfinity`

> `(options: SendOptions) => Promise<PayStream>`

Sends a streaming payment to the provided recipient payment pointer.

`tap` is designed to be used with [Web Monetization](https://webmonetization.org/), and tries to send as much money as possible, as fast as possible. It starts sending fulfillable packets immediately&mdash;without any probe or preflight&mdash;and automatically discovers and utilizes the available liquidity bandwidth. `tap` also enables the payment to be paused and resumed, as the application sees fit.

:warning: Invoking this function will attempt to send **as much money as possible** through the connected uplink. This is highly recommended to be used in conjunction with bandwidth or throughput limits configured in an ILP connector.

:warning: No exchange rates are enforced, so money may still be sent even if none reaches the recipient.

### `SendOptions`

> Interface

TODO explain here

TODO table

- paymentPointer
- plugin
- initialPacketAmount
- useFarFutureExpiry

### `PayStream`

> Interface

TODO Explain

`start`
`stop`
`destinationAsset`

TODO Add another table for events right below

#### `progress` Event

TODO Should this be renamed to "delivered"?

`amount`
`streamReceipt`
