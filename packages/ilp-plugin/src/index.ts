/* eslint-disable @typescript-eslint/no-var-requires */
import * as crypto from 'crypto'
import { URL } from 'url'

const log = require('ilp-logger')('ilp-plugin')

const generateCredentials = (opts?: any) => {
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

export const pluginFromEnvironment = (opts?: any) => {
  const module = process.env.ILP_PLUGIN || 'ilp-plugin-btp'
  const credentials = generateCredentials(opts)

  log.debug('creating plugin with module', module)
  log.debug('creating plugin with credentials', credentials)
  const Plugin = require(module)
  return new Plugin(credentials)
}

module.exports = pluginFromEnvironment
