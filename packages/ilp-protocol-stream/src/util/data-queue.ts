// Inspired by https://github.com/toajs/quic/blob/master/src/stream.ts

/** @private */
export class DataQueueEntry {
  data: Buffer
  next?: DataQueueEntry
  callback?: () => void
  constructor (buf: Buffer, callback?: () => void, entry?: DataQueueEntry) {
    this.data = buf
    this.callback = callback
    this.next = entry
  }
}

/** @private */
export class DataQueue {
  head?: DataQueueEntry
  tail?: DataQueueEntry
  length: number
  constructor () {
    this.length = 0
  }

  push (buf: Buffer, callback?: () => void): void {
    const entry = new DataQueueEntry(buf, callback)

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

    let bytesLeft = n
    const chunks: Buffer[] = []
    while (bytesLeft > 0 && this.length > 0) {
      let chunk = this.head.data
      if (chunk.length > bytesLeft) {
        this.head.data = chunk.slice(bytesLeft)
        chunk = chunk.slice(0, bytesLeft)
        chunks.push(chunk)
        bytesLeft -= chunk.length
      } else {
        chunks.push(chunk) // ret.length <= n
        bytesLeft -= chunk.length
        if (this.head && this.head.callback) {
          this.head.callback()
        }
        this.shift()
      }
    }

    return Buffer.concat(chunks)
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
