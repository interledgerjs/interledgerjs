'use strict'

const PluginPaymentChannel = require('../..')
const ObjStore = require('../helpers/objStore')
const Token = require('../../src/util/token')
const crypto = require('crypto')
const base64url = require('base64url')

let plugins = [ null, null ]

const Koa = require('koa')
const parser = require('koa-bodyparser')
const router = require('koa-router')()
const app = new Koa()
const port = 23457

async function rpc (index, context) {
  const plugin = plugins[index]
  const { method } = context.query
  const params = context.request.body
  context.body = await plugin.receive(method, params)
}

router.post('/pluginA', rpc.bind(null, 0))
router.post('/pluginB', rpc.bind(null, 1))

app
  .use(parser())
  .use(router.routes())
  .use(router.allowedMethods())
  .listen(port)

exports.plugin = PluginPaymentChannel
exports.timeout = 1000
exports.getPlugins = async function () {
  if (plugins[0]) return plugins

  const secretA = base64url(crypto.randomBytes(32))
  const secretB = base64url(crypto.randomBytes(32))

  plugins[0] = new PluginPaymentChannel({
    currencyCode: 'USD',
    currencyScale: 6,
    maxBalance: '1000',
    secret: secretA,
    peerPublicKey: Token.publicKey(secretB),
    rpcUri: 'http://localhost:' + port + '/pluginB',
    _store: new ObjStore()
  })

  plugins[1] = new PluginPaymentChannel({
    currencyCode: 'USD',
    currencyScale: 6,
    maxBalance: '1000',
    secret: secretB,
    peerPublicKey: Token.publicKey(secretA),
    rpcUri: 'http://localhost:' + port + '/pluginA',
    _store: new ObjStore()
  })

  return plugins
}
