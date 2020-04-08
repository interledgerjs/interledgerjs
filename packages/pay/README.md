# @interledger/pay

> Send payments over Interledger

[WIP]

```js
import { quote, pay } from '@interledger/pay'

const params = await quote('$rafiki.money/invoices/2ca39a18', plugin)
console.log(params)
// {
//   amountToSend: '3.45063',
//   sourceAssetCode: 'USD',
//   amountToDeliver: '3.1388',
//   destinationAssetCode: 'EUR',
//   minExchangeRate: '0.905',
//   estimatedExchangeRate: '0.91',
//   ...
// }

const receipt = await pay(params)
console.log(receipt)
// {
//    status: 'success',
//    amountDelivered: '3.1388',
//    amountSent: '3.43014',
//    amountInFlight: '0',
//    ...
// }
```
