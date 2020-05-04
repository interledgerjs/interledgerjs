## `@interledger/pay`

> Send payments over Interledger

### Fixed Delivery Payment

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

### Fixed Source Amount Payment

```js
import { quote } from '@interledger/pay'

const { pay, ...details } = await quote({
  plugin,
  paymentPointer: '$rafiki.money/p/example',
  amountToSend: '3.14159'
})

const receipt = await pay()
```

### Error Handling

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
