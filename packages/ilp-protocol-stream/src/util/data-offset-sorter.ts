// Inspired by https://github.com/toajs/quic/blob/master/src/stream.ts

export class OffsetDataEntry {
  data?: Buffer
  offset: number
  next?: OffsetDataEntry
  constructor (data: Buffer, offset: number, next?: OffsetDataEntry) {
    this.data = data
    this.offset = offset
    this.next = next
  }
}

export class OffsetSorter {
  head?: OffsetDataEntry
  readOffset: number
  endOffset: number
  constructor () {
    this.readOffset = 0
    this.endOffset = -1
  }

  setEndOffset (offset: number) {
    this.endOffset = offset
  }

  isEnd (): boolean {
    return this.readOffset === this.endOffset
  }

  push (data: Buffer, offset: number) {
    const entry = new OffsetDataEntry(data, offset)

    if (!this.head) {
      this.head = entry
    } else if (this.head.offset > offset) {
      entry.next = this.head
      this.head = entry
    } else {
      let prev = this.head
      while (true) {
        if (!prev.next) {
          prev.next = entry
          break
        }
        if (prev.next.offset > offset) {
          entry.next = prev.next
          prev.next = entry
          break
        }
        prev = prev.next
      }
    }
  }

  read (): Buffer | undefined {
    let data
    if (this.head && this.readOffset === this.head.offset) {
      data = this.head.data
      this.readOffset = this.head.offset + (data ? data.length : 0)
      this.head = this.head.next
    }
    return data
  }
}
