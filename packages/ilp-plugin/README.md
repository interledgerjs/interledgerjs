# ILP Plugin
> A generic handle to ILP

The script below will get ILP credentials with no setup whatsoever.  You can
use this anywhere that you need an ILP plugin created from details in the
environment.

```js
const plugin = require('ilp-plugin')()

async function run () {
  await plugin.connect()
  await plugin.sendData(/* ... */)
  process.exit(0)
}

run()
```

First, the script checks whether `ILP_CREDENTIALS` is defined in the environment.
`ILP_CREDENTIALS` must contain a JSON object with the options passed into the
constructor of `ilp-plugin-btp` or the module name in `ILP_PLUGIN`.

By default, a random secret will be generated and the plugin will connect to
`btp+ws://localhost:7768`.
