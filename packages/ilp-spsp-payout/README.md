# ILP SPSP Payout

> A util for sending out payments to specific payment pointers over ILP

## Usage

### Installation

```sh
npm install ilp-spsp-payout
```

### Send Payments

```js
const { Payout } = require('ilps-spsp-payout')

const payer = new Payout()
payer.send('$twitter.xrptipbot.com/androswong418', 100000)
```

Note: To send payments locally a live moneyd instance must be running on your machine. For more instructions please visit https://github.com/interledgerjs/moneyd
