# ILP Plugin
> A generic handle to ILP

The script below (also in `./examples/info.js`) will magically get ILP
credentials with no setup whatsoever.  Set `DEBUG=* node ./examples/info.js` to
see behind the scenes.

```js
const plugin = require('ilp-plugin')()

async function run () {
  await plugin.connect()
  console.log("Got plugin with info:", plugin.getInfo())
  console.log("Got balance:", await plugin.getBalance())
  process.exit(0)
}

run()
```

First, the script checks whether `ILP_CREDENTIALS` is defined in the environment.
`ILP_CREDENTIALS` must contain a JSON object with the options passed into the
constructor of `ilp-plugin-xrp-escrow` or the module name in `ILP_PLUGIN`.
If you want to acquire testnet credentials and load them into your environment,
try [this script](https://gist.github.com/sharafian/bb3955eaf3a97aa1bc43dc8a9e76256a#ilp-credentials).

If `ILP_CREDENTIALS` is not defined, the existence of `./.ilprc.json` is checked.
If it exists, it will be loaded and the module name in the `plugin` field will
be required. The options in `credentials` are passed into this constructor, and
the resultant plugin is returned.

If `./.ilprc.json` does not exist, `~/.ilprc.json` is checked in the same way.

If none of these is specified, the plugin will ask [the XRP test net
faucet](https://ripple.com/build/xrp-test-net/) for some XRP credentials.  On
connection of the returned plugin, the faucet is queried and the results are
stored in `~/.ilprc.json`. The `connect` function will resolve when the faucet
completes account setup. From that point on, the plugin is an ordinary instance
of `ilp-plugin-xrp-escrow`.
