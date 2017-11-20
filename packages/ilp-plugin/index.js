const request = require('superagent')
const fs = require('fs')
const path = require('path')
const debug = require('debug')('ilp-plugin')
const crypto = require('crypto')

function pluginFromEnvironment () {
  const module = process.env.ILP_PLUGIN || 'ilp-plugin-xrp-escrow'
  debug('creating plugin with module', module)

  const Plugin = require(module)
  return new Plugin(JSON.parse(process.env.ILP_CREDENTIALS))
}

function getRc ({ testnet, local }) {
  const rootPath = local ? process.cwd() : process.env.HOME
  return path.join(rootPath,
    testnet ? '.ilprc.test.json' : '.ilprc.json')
}

function pluginFromIlpRc (rc) {
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
    const listeners = []
    this.on = function (event, callback) {
      listeners.push({ event, callback })
    }

    this.connect = async function () {
      const res = await request.post('https://faucet.altnet.rippletest.net/accounts')
      debug('loaded testnet credentials; writing to', getRc({ local: false }))
      const credentials = {
        address: res.body.account.address,
        secret: res.body.account.secret,
        server: 'wss://s.altnet.rippletest.net:51233',
        prefix: 'test.crypto.xrp.'
      }
      fs.writeFileSync(getRc({ local: false }), JSON.stringify({
        plugin: 'ilp-plugin-xrp-escrow',
        credentials
      }))

      debug('instantiating plugin; waiting for account creation')
      const plugin = new PluginXrpEscrow(credentials)
      Object.setPrototypeOf(this, plugin)

      delete this.connect
      delete this.on

      for (const listener of listeners) {
        console.log('adding listener:', listener)
        this.on(listener.event, listener.callback)
      }

      await this.connect()
      return new Promise((resolve) => this.on('incoming_message', (m) => {
        debug('testnet account created at address', m.to)
        resolve()
      }))
    }
  }
  return new MetaPlugin()
}

function pluginFromDemoServer () {
  debug('automatically creating demo server plugin')
  const Plugin = require('ilp-plugin-payment-channel-framework')
  const secret = crypto.randomBytes(8).toString('hex')
  const server = `btp+ws://:${secret}@45.55.1.226`
  return new Plugin({ server })
}

module.exports = function (opts) {
  if (process.env.ILP_CREDENTIALS) {
    return pluginFromEnvironment()
  } else if (fs.existsSync(getRc({ local: true }))) {
    return pluginFromIlpRc(getRc({ local: true }))
  } else if (fs.existsSync(getRc({ local: false }))) {
    return pluginFromIlpRc(getRc({ local: false }))
  } else if (opts && opts.testnet) {
    return pluginFromTestnet()
  } else {
    return pluginFromDemoServer()
  }
}
