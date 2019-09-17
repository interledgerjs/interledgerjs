import * as assert from 'assert'
import { OffsetSorter } from '../../src/util/data-offset-sorter'

describe('OffsetSorter', function () {
  beforeEach(function () {
    this.sorter = new OffsetSorter()
  })

  describe('constructor', function () {
    it('begins empty', function () {
      assert.equal(this.sorter.readOffset, 0)
      assert.equal(this.sorter.maxOffset, 0)
    })
  })

  describe('read', function () {
    it('returns undefined when there is no data', function () {
      assert.equal(this.sorter.read(), undefined)
      assert.equal(this.sorter.readOffset, 0)
    })

    it('returns undefined when there is no data at the current offset', function () {
      this.sorter.push(Buffer.from("foo"), 1)
      assert.equal(this.sorter.read(), undefined)
      assert.equal(this.sorter.readOffset, 0)
      assert.equal(this.sorter.maxOffset, 4)
    })

    it('returns out-of-order data in order', function () {
      this.sorter.push(Buffer.from("BC"), 1)
      this.sorter.push(Buffer.from("A"), 0)
      assert.equal(this.sorter.maxOffset, 3)

      assert.deepEqual(this.sorter.read(), Buffer.from("A"))
      assert.equal(this.sorter.readOffset, 1)

      assert.deepEqual(this.sorter.read(), Buffer.from("BC"))
      assert.equal(this.sorter.readOffset, 3)

      assert.equal(this.sorter.read(), undefined)
      assert.equal(this.sorter.readOffset, 3)
    })
  })

  describe('byteLength', function () {
    it('returns zero when there is no data', function () {
      assert.equal(this.sorter.byteLength(), 0)
    })

    it('returns zero when there is no data at the current offset', function () {
      this.sorter.push(Buffer.from("foo"), 1)
      assert.equal(this.sorter.byteLength(), 0)
    })

    it('returns the length of the available data', function () {
      this.sorter.push(Buffer.from("foo"), 0)
      assert.equal(this.sorter.byteLength(), 3)

      this.sorter.push(Buffer.from("bar"), 3)
      assert.equal(this.sorter.byteLength(), 6)
    })
  })
})
