const plugin = require('..')()

async function run () {
  await plugin.connect()
  console.log("Got plugin with info:", plugin.getInfo())
  console.log("Got balance:", await plugin.getBalance())
  process.exit(0)
}

run()
