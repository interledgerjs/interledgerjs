const fs = require('fs')
const path = require('path')
const debug = require('debug')('ilp-plugin')
const crypto = require('crypto')

function pluginFromEnvironment () {
  const module = process.env.ILP_PLUGIN || 'ilp-plugin-btp'
  const secret = require('crypto').randomBytes(16).toString('hex')
  const credentials = process.env.ILP_CREDENTIALS
    ? JSON.parse(process.env.ILP_CREDENTIALS)
    : { server: `btp+ws://:${secret}@localhost:7768` }

  debug('creating plugin with module', module)
  const Plugin = require(module)
  return new Plugin(credentials)
}

module.exports = function (opts) {
  return pluginFromEnvironment()
}
