import { Duplex } from 'stream'

export class DataStream extends Duplex {
  readonly id: number
  protected _incoming: OffsetSorter
  protected _outgoing: DataQueue
  protected outgoingOffset: number
  protected ended: boolean

  constructor (streamId: number, options?: any) {
    super(options)
    this.id = streamId
    this._incoming = new OffsetSorter()
    this._outgoing = new DataQueue()
    this.outgoingOffset = 0
    this.ended = false
  }

  _final (callback: (...args: any[]) => void): void {
    callback()
  }

  _write (chunk: Buffer, encoding: string, callback: (...args: any[]) => void): void {
    this._outgoing.push(chunk)
    callback()
  }

  _read (size: number): void {
    const data = this._incoming.read()
    if (data) {
      if (this.push(data) && size > data.length) {
        this._read(size - data.length)
        return
      }
    }

    if (!this.ended && this._incoming.isEnd()) {
      this.ended = true
      this.push(null)
    }
  }

  _getAvailableDataToSend (size: number): { data: Buffer | undefined, offset: number } {
    const data = this._outgoing.read(size)
    const offset = this.outgoingOffset
    if (data) {
      this.outgoingOffset = this.outgoingOffset += data.length
    }
    return { data, offset }
  }

  _pushIncomingData (data: Buffer, offset: number) {
    this._incoming.push(data, offset)

    // TODO how much should we try to read?
    this._read(data.length)
  }

  _remoteEnded (): void {
    this.ended = true
  }
}

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

    if (this.tail != null) {
      this.tail.next = entry
    } else {
      this.head = entry
    }
    this.tail = entry
    this.length += 1
  }

  shift () {
    if (this.head == null) {
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
    if (this.head === undefined) {
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
}

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

    if (this.head == null) {
      this.head = entry
    } else if (this.head.offset > offset) {
      entry.next = this.head
      this.head = entry
    } else {
      let prev = this.head
      while (true) {
        if (prev.next == null) {
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
    if (this.head != null && this.readOffset === this.head.offset) {
      data = this.head.data
      this.readOffset = this.head.offset + (data != null ? data.length : 0)
      this.head = this.head.next
    }
    return data
  }
}
