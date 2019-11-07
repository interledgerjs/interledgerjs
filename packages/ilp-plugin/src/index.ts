import * as crypto from 'crypto'
import { URL } from 'url'

const log = require('ilp-logger')('ilp-plugin')

function pluginFromEnvironment (opts) {
  const module = process.env.ILP_PLUGIN || 'ilp-plugin-btp'
  const credentials = generateCredentials(opts)

  log.debug('creating plugin with module', module)
  log.debug('creating plugin with credentials', credentials)
  const Plugin = require(module)
  return new Plugin(credentials)
}

function generateCredentials (opts) {
  if (process.env.ILP_CREDENTIALS) {
    return JSON.parse(process.env.ILP_CREDENTIALS)
  }

  const secret = crypto.randomBytes(16).toString('hex')
  const name = (opts && opts.name) || ''

  if (process.env.ILP_BTP_SERVER) {
    const url = new URL(process.env.ILP_BTP_SERVER)
    return { server: `${url.protocol}//${name}:${secret}@${url.host}` }
  }

  return { server: `btp+ws://${name}:${secret}@localhost:7768` }
}

module.exports = pluginFromEnvironment
