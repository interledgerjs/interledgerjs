import * as assert from 'assert'
import * as sinon from 'sinon'
import { AgingSet } from '../../src/util/aging-set'

describe('AgingSet', function () {
  beforeEach(function () {
    this.clock = sinon.useFakeTimers({
      toFake: ['setInterval']
    })
    this.set = new AgingSet(1000)
  })

  afterEach(function () {
    this.clock.restore()
  })

  it('includes newly added elements', function () {
    this.set.add("foo")
    assert(this.set.has("foo"))
  })

  it('doesn\'t include random elements', function () {
    assert(!this.set.has("foo"))
  })

  it('includes once-rotated elements', function () {
    this.set.add("foo")
    this.clock.tick(1001)
    assert(this.set.has("foo"))
  })

  it('doesn\'t include twice-rotated elements', function () {
    this.set.add("foo")
    this.clock.tick(2001)
    assert(!this.set.has("foo"))
  })
})
