import * as assert from 'assert'
import { DataQueue } from '../../src/util/data-queue'

describe('DataQueue', function () {
  beforeEach(function () {
    this.queue = new DataQueue()
  })

  describe('read', function () {
    it('returns undefined when there is no data', function () {
      assert.equal(this.queue.read(1), undefined)
    })

    it('returns a partial chunk', function () {
      this.queue.push(Buffer.from("abc"))
      assert.deepEqual(this.queue.read(1), Buffer.from("a"))
    })

    it('returns avalable data', function () {
      this.queue.push(Buffer.from("abc"))
      assert.deepEqual(this.queue.read(9), Buffer.from("abc"))
    })

    it('returns sequential data', function () {
      this.queue.push(Buffer.from("abc"))
      this.queue.push(Buffer.from("def"))
      assert.deepEqual(this.queue.read(2), Buffer.from("ab"))
      assert.deepEqual(this.queue.read(2), Buffer.from("cd"))
      assert.deepEqual(this.queue.read(2), Buffer.from("ef"))
      assert.equal(this.queue.read(1), undefined)
    })

    it('calls the callback when a chunk is consumed', function () {
      let c1 = 0
      let c2 = 0
      this.queue.push(Buffer.from("abc"), () => c1++)
      this.queue.push(Buffer.from("def"), () => c2++)

      this.queue.read(2)
      assert.equal(c1, 0)
      assert.equal(c2, 0)

      this.queue.read(2)
      assert.equal(c1, 1)
      assert.equal(c2, 0)

      this.queue.read(2)
      assert.equal(c1, 1)
      assert.equal(c2, 1)
    })
  })

  describe('isEmpty', function () {
    it('is initially empty', function () {
      assert(this.queue.isEmpty())
    })

    it('returns whether or not the queue is empty', function () {
      this.queue.push(Buffer.from("abc"))
      this.queue.read(2)
      assert(!this.queue.isEmpty())
      this.queue.read(1)
      assert(this.queue.isEmpty())
    })
  })
})
