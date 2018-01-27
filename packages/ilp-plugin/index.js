const fs = require('fs')
const path = require('path')
const debug = require('debug')('ilp-plugin')
const crypto = require('crypto')

function pluginFromEnvironment (opts) {
  const module = process.env.ILP_PLUGIN || 'ilp-plugin-btp'
  const secret = require('crypto').randomBytes(16).toString('hex')
  const name = (opts && opts.name) || ''
  const credentials = process.env.ILP_CREDENTIALS
    ? JSON.parse(process.env.ILP_CREDENTIALS)
    : { server: `btp+ws://${name}:${secret}@localhost:7768` }

  debug('creating plugin with module', module)
  debug('creating plugin with credentials', credentials)
  const Plugin = require(module)
  return new Plugin(credentials)
}

module.exports = function (opts) {
  return pluginFromEnvironment(opts)
}
