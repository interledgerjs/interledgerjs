import 'mocha'
import makePlugin, { pluginFromEnvironment } from '../src'
import { assert } from 'chai'

describe('ilp-plugin', function () {
  it('plugin should be a function', function () {
    assert(typeof makePlugin === 'function')
    assert(typeof pluginFromEnvironment === 'function')
  })
})
