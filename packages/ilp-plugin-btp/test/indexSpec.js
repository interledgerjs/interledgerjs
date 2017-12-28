'use strict'

const assert = require('chai').assert

const PluginBtp = require('..')
const options = {
  server: 'btp+wss://user:placeholder@example.com/rpc'
}

describe('constructor', () => {
  it('should be a function', () => {
    assert.isFunction(PluginBtp)
  })

  it('should return an object', () => {
    assert.isObject(new PluginBtp(options))
  })
})
