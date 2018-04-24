// Inspired by https://github.com/toajs/quic/blob/master/src/stream.ts

export class DataQueueEntry {
  data: Buffer
  next?: DataQueueEntry
  constructor (buf: Buffer, entry?: DataQueueEntry) {
    this.data = buf
    this.next = entry
  }
}

export class DataQueue {
  head?: DataQueueEntry
  tail?: DataQueueEntry
  length: number
  constructor () {
    this.length = 0
  }

  push (buf: Buffer): void {
    const entry = new DataQueueEntry(buf)

    if (this.tail) {
      this.tail.next = entry
    } else {
      this.head = entry
    }
    this.tail = entry
    this.length += 1
  }

  shift () {
    if (!this.head) {
      return null
    }
    const ret = this.head.data
    if (this.length === 1) {
      this.head = this.tail = undefined
    } else {
      this.head = this.head.next
    }
    this.length -= 1
    return ret
  }

  read (n: number): Buffer | undefined {
    if (!this.head) {
      return undefined
    }

    let ret = this.head.data
    if (ret.length > n) {
      this.head.data = ret.slice(n)
      ret = ret.slice(0, n)
      return ret
    }
    this.shift()
    return ret // ret.length <= n
  }

  isEmpty (): boolean {
    return this.length === 0
  }

  byteLength (): number {
    let length = 0
    let entry = this.head
    while (entry) {
      length += entry.data.length
      entry = entry.next
    }
    return length
  }
}
