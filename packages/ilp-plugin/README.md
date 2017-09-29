# ILP Plugin
> A generic handle to ILP

Try it with the script below:

```
const plugin = require('./index.js')({ testnet: true })

async function run () {
  await plugin.connect()
  console.log("Got plugin with info:", plugin.getInfo())
  console.log("Got balance:", await plugin.getBalance())
  process.exit(0)
}

run()
```
