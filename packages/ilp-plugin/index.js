const request = require('superagent')
const fs = require('fs')
const path = require('path')
const debug = require('debug')('ilp-plugin')

function pluginFromEnvironment () {
  const module = process.env.ILP_PLUGIN || 'ilp-plugin-xrp-escrow'
  debug('creating plugin with module', module)

  const Plugin = require(module)
  return new Plugin(JSON.parse(process.env.ILP_CREDENTIALS))
}

function getRc (testnet = false) {
  return path.join(process.env.HOME,
    testnet ? '.ilprc.test.json' : '.ilprc.json')
}

function pluginFromIlpRc (testnet = false) {
  const rc = getRc(testnet)
  debug('loading credentials from', rc)

  const contents = fs.readFileSync(rc)
  const config = JSON.parse(contents.toString('utf8'))
  debug('creating plugin with module', config.plugin)

  const Plugin = require(config.plugin)
  return new Plugin(config.credentials)
}

function pluginFromTestnet () {
  debug('automatically creating xrp testnet plugin')
  const PluginXrpEscrow = require('ilp-plugin-xrp-escrow')
  const MetaPlugin = function () {
    this.connect = async function () {
      const res = await request.post('https://faucet.altnet.rippletest.net/accounts')
      debug('loaded testnet credentials; writing to', getRc(true))
      const credentials = {
        address: res.body.account.address,
        secret: res.body.account.secret,
        server: 'wss://s.altnet.rippletest.net:51233'
      }
      fs.writeFileSync(getRc(true), JSON.stringify({
        plugin: 'ilp-plugin-xrp-escrow',
        credentials
      }))
      debug('instantiating plugin; waiting for account creation')
      const plugin = new PluginXrpEscrow(credentials)
      Object.setPrototypeOf(this, plugin)
      delete this.connect
      await this.connect()
      return new Promise((resolve) => this.on('incoming_message', (m) => {
        debug('testnet account created at address', m.to)
        resolve()
      }))
    }
  }
  return new MetaPlugin()
}

module.exports = function ({ testnet, noFileRead }) {
  if (process.env.ILP_CREDENTIALS) {
    return pluginFromEnvironment()
  } else if (!noFileRead && fs.existsSync(getRc(testnet))) {
    return pluginFromIlpRc(testnet)  
  } else if (testnet) {
    return pluginFromTestnet()
  }
  throw new Error(`ILP_CREDENTIALS must be defined in the environment for ILP
    payments to be made. To automatically generate testnet credentials, call
    the 'ilp-plugin' module with '{ testnet: true }'`)
}
