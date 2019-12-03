import 'mocha'
import makePlugin, { pluginFromEnvironment } from '../src'
import * as sinon from 'sinon'
import * as Chai from 'chai'
const assert = Object.assign(Chai.assert, sinon.assert)
require('source-map-support').install()

describe('ilp-plugin', function () {
  it('plugin should be a function', function () {
    assert(typeof makePlugin === 'function')
    assert(typeof pluginFromEnvironment === 'function')
  })
})
