import { UnderflowError } from '../errors/underflow-error'
import { ParseError } from '../errors/parse-error'
import * as Long from 'long'
import { bufferToLong, MAX_SAFE_BYTES } from './util'

export class Reader {
  // Most significant bit in a byte
  static HIGH_BIT = 0x80

  // Other bits in a byte
  static LOWER_SEVEN_BITS = 0x7F

  buffer: Buffer
  cursor: number
  bookmarks: number[]

  constructor (buffer: Buffer) {
    this.buffer = buffer
    this.cursor = 0
    this.bookmarks = []
  }

  /**
   * Create a Reader from a source of bytes.
   *
   * Currently, this method only allows the creation of a Reader from a Buffer.
   *
   * If the object provided is already a Reader, that reader is returned as is.
   *
   * @param source Source of binary data.
   * @return Instance of Reader
   */
  static from (source: Buffer | Reader): Reader {
    if (Buffer.isBuffer(source)) {
      return new Reader(source)
    } else if (source instanceof Reader) {
      return new Reader(source.buffer.slice(source.cursor))
    } else {
      throw new Error('Reader must be given a Buffer')
    }
  }

  /**
   * Store the current cursor position on a stack.
   */
  bookmark (): void {
    this.bookmarks.push(this.cursor)
  }

  /**
   * Pop the most recently bookmarked cursor position off the stack.
   */
  restore (): void {
    if (!this.bookmarks.length) {
      throw new Error('Cannot restore bookmark when no bookmark set')
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.cursor = this.bookmarks.pop()!
  }

  /**
   * Ensure this number of bytes is buffered.
   *
   * This method checks that the given number of bytes is buffered and available
   * for reading. If insufficient bytes are available, the method throws an
   * `UnderflowError`.
   *
   * @param bytes Number of bytes that should be available.
   */
  ensureAvailable (bytes: number): void {
    if (this.buffer.length < (this.cursor + bytes)) {
      throw new UnderflowError('Tried to read ' + bytes + ' bytes, but only ' +
        (this.buffer.length - this.cursor) + ' bytes available')
    }
  }

  /**
   * Read a fixed-length unsigned big-endian integer as a JS number.
   *
   * @param length Length of the integer in bytes.
   */
  readUIntNumber (length: number): number {
    if (length < 1) {
      throw new Error('UInt length must be greater than zero')
    } else if (MAX_SAFE_BYTES < length) {
      throw new Error('Value does not fit a JS number without sacrificing precision')
    } else {
      const value = this.buffer.readUIntBE(this.cursor, length)
      this.cursor += length
      return value
    }
  }

  /**
   * Read a fixed-length unsigned big-endian integer as a Long.
   *
   * @param length Length of the integer in bytes.
   */
  readUIntLong (length: number): Long {
    const value = this.peekUIntLong(length)
    this.cursor += length
    return value
  }

  /**
   * Read a fixed-length unsigned big-endian integer as a string.
   *
   * @param length Length of the integer in bytes.
   */
  readUInt (length: number): string {
    if (length >= 1 && length <= MAX_SAFE_BYTES) {
      return String(this.readUIntNumber(length))
    } else {
      return this.readUIntLong(length).toString()
    }
  }

  peekUIntNumber (length: number): number {
    if (length >= 1 && length <= MAX_SAFE_BYTES) {
      return this.buffer.readUIntBE(this.cursor, length)
    } else {
      throw new Error('Value does not fit a JS number without sacrificing precision')
    }
  }

  /**
   * Look at a fixed-length unsigned integer as a Long, but don't advance the cursor.
   *
   * @param length Length of the integer in bytes.
   */
  peekUIntLong (length: number): Long {
    if (length === 0) {
      return Long.UZERO
    } else if (length < 0) {
      throw new Error('Tried to read integer with negative length (provided: ' +
        length + ')')
    } else if (length > 8) {
      throw new Error('UInts longer than 8 bytes must be encoded as VarUInts')
    }

    return bufferToLong(this.peek(length), true)
  }

  /**
   * Look at a fixed-length unsigned integer as a string, but don't advance the cursor.
   *
   * @param length Length of the integer in bytes.
   */
  peekUInt (length: number): string {
    if (length >= 1 && length <= MAX_SAFE_BYTES) {
      return String(this.peekUIntNumber(length))
    } else {
      return this.peekUIntLong(length).toString()
    }
  }

  /**
   * Advance cursor by length bytes.
   */
  skipUInt (length: number): void {
    this.skip(length)
  }

  /**
   * Read a fixed-length signed big-endian integer as a JS number.
   *
   * @param length Length of the integer in bytes.
   */
  readIntNumber (length: number): number {
    if (length < 1) {
      throw new Error('Int length must be greater than zero')
    } else if (MAX_SAFE_BYTES < length) {
      throw new Error('Value does not fit a JS number without sacrificing precision')
    } else {
      const value = this.buffer.readIntBE(this.cursor, length)
      this.cursor += length
      return value
    }
  }

  /**
   * Read a fixed-length signed big-endian integer.
   *
   * @param length Length of the integer in bytes.
   */
  readIntLong (length: number): Long {
    const value = this.peekIntLong(length)
    this.cursor += length
    return value
  }

  /**
   * Read a fixed-length signed big-endian integer as a string.
   *
   * @param length Length of the integer in bytes.
   */
  readInt (length: number): string {
    if (length >= 1 && length <= MAX_SAFE_BYTES) {
      return String(this.readIntNumber(length))
    } else {
      return this.readIntLong(length).toString()
    }
  }

  /**
   * Read a fixed-length signed big-endian integer as a JS number.
   *
   * @param length Length of the integer in bytes.
   */
  peekIntNumber (length: number): number {
    if (length >= 1 && length <= MAX_SAFE_BYTES) {
      return this.buffer.readIntBE(this.cursor, length)
    } else {
      throw new Error('Value does not fit a JS number without sacrificing precision')
    }
  }

  /**
   * Look at a fixed-length signed integer, but don't advance the cursor.
   *
   * @param length Length of the integer in bytes.
   */
  peekIntLong (length: number): Long {
    if (length === 0) {
      return Long.ZERO
    } else if (length < 0) {
      throw new Error('Tried to read integer with negative length (provided: ' +
        length + ')')
    } else if (length > 8) {
      throw new Error('Ints longer than 8 bytes must be encoded as VarInts')
    }

    return bufferToLong(this.peek(length), false)
  }

  /**
   * Look at a fixed-length signed integer as a string, but don't advance the cursor.
   *
   * @param length Length of the integer in bytes.
   */
  peekInt (length: number): string {
    if (length >= 1 && length <= MAX_SAFE_BYTES) {
      return String(this.peekIntNumber(length))
    } else {
      return this.peekIntLong(length).toString()
    }
  }

  /**
   * Advance cursor by length bytes.
   */
  skipInt (length: number): void {
    this.skip(length)
  }

  /**
   * Read a variable-length unsigned integer at the cursor position and advance the cursor.
   */
  readVarUIntNumber (): number {
    if (this.buffer[this.cursor] === 0) {
      throw new ParseError('UInt of length 0 is invalid')
    }

    // Interledger uses canonical OER (C-OER), so we know that any value that
    // fits six bytes MUST be encoded with a one-byte length determinant
    if (this.buffer[this.cursor] <= MAX_SAFE_BYTES) {
      return this.readUIntNumber(this.buffer[this.cursor++])
    } else {
      throw new Error('Value does not fit a JS number without sacrificing precision')
    }
  }

  /**
   * Read a variable-length unsigned integer at the cursor position and advance the cursor.
   */
  readVarUIntLong (): Long {
    const buffer = this.readVarOctetString()
    if (buffer.length === 0) {
      throw new ParseError('UInt of length 0 is invalid')
    }

    return bufferToLong(buffer, true)
  }

  /**
   * Read a variable-length unsigned integer at the cursor position as a string and advance the cursor.
   */
  readVarUInt (): string {
    return this.readVarUIntLong().toString()
  }

  /**
   * Read the next variable-length unsigned integer as a JS number, but don't advance the cursor.
   */
  peekVarUIntNumber (): number {
    this.bookmark()
    const value = this.readVarUIntNumber()
    this.restore()

    return value
  }

  /**
   * Read the next variable-length unsigned integer as a Long, but don't advance the cursor.
   */
  peekVarUIntLong (): Long {
    this.bookmark()
    const value = this.readVarUIntLong()
    this.restore()

    return value
  }

  /**
   * Read the next variable-length unsigned integer, but don't advance the cursor.
   */
  peekVarUInt (): string {
    return this.peekVarUIntLong().toString()
  }

  /**
   * Skip past the variable-length unsigned integer at the cursor position.
   *
   * Since variable integers are encoded the same way as octet strings, this
   * method is equivalent to skipVarOctetString.
   */
  skipVarUInt (): void {
    this.skipVarOctetString()
  }

  /**
   * Read a variable-length unsigned integer at the cursor position and advance the cursor.
   */
  readVarIntNumber (): number {
    if (this.buffer[this.cursor] === 0) {
      throw new ParseError('Int of length 0 is invalid')
    }

    // Interledger uses canonical OER (C-OER), so we know that any value that
    // fits six bytes MUST be encoded with a one-byte length determinant
    if (this.buffer[this.cursor] <= MAX_SAFE_BYTES) {
      return this.readIntNumber(this.buffer[this.cursor++])
    } else {
      throw new Error('Value does not fit a JS number without sacrificing precision')
    }
  }

  /**
   * Read a variable-length unsigned integer at the cursor position and advance the cursor.
   */
  readVarIntLong (): Long {
    const buffer = this.readVarOctetString()

    if (buffer.length === 0) {
      throw new ParseError('Int of length 0 is invalid')
    }

    return bufferToLong(buffer, false)
  }

  /**
   * Read a variable-length unsigned integer at the cursor position as a string and advance the cursor.
   */
  readVarInt (): string {
    return this.readVarIntLong().toString()
  }

  /**
   * Read the next variable-length unsigned integer, but don't advance the cursor.
   */
  peekVarIntNumber (): number {
    this.bookmark()
    const value = this.readVarIntNumber()
    this.restore()

    return value
  }

  /**
   * Read the next variable-length unsigned integer, but don't advance the cursor.
   */
  peekVarIntLong (): Long {
    this.bookmark()
    const value = this.readVarIntLong()
    this.restore()

    return value
  }

  /**
   * Read the next variable-length unsigned integer as a string, but don't advance the cursor.
   */
  peekVarInt (): string {
    return this.peekVarIntLong().toString()
  }

  /**
   * Skip past the variable-length signed integer at the cursor position.
   *
   * Since variable integers are encoded the same way as octet strings, this
   * method is equivalent to skipVarOctetString.
   */
  skipVarInt (): void {
    this.skipVarOctetString()
  }

  /**
   * Read a fixed-length octet string.
   *
   * @param length Length of the octet string.
   */
  readOctetString (length: number): Buffer {
    return this.read(length)
  }

  /**
   * Peek at a fixed length octet string.
   *
   * @param length Length of the octet string.
   */
  peekOctetString (length: number): Buffer {
    return this.peek(length)
  }

  /**
   * Skip a fixed length octet string.
   *
   * @param length Length of the octet string.
   */
  skipOctetString (length: number): void {
    return this.skip(length)
  }

  /**
   * Read a length prefix.
   *
   * You shouldn't need this. Length prefixes are used internally by
   * variable-length octet strings and integers.
   */
  readLengthPrefix (): number {
    const length = this.readUInt8Number()

    if (length & Reader.HIGH_BIT) {
      const lengthPrefixLength = length & Reader.LOWER_SEVEN_BITS
      const actualLength = lengthPrefixLength && this.readUIntNumber(lengthPrefixLength)

      // Reject lengths that could have been encoded with a shorter prefix
      const minLength = Math.max(128, 1 << ((lengthPrefixLength - 1) * 8))
      if (lengthPrefixLength === 0 || actualLength < minLength) {
        throw new ParseError('Length prefix encoding is not canonical: ' +
          actualLength + ' encoded in ' + lengthPrefixLength + ' bytes')
      }

      return actualLength
    }

    return length
  }

  /**
   * Read a variable-length octet string.
   *
   * A variable-length octet string is a length-prefixed set of arbitrary bytes.
   */
  readVarOctetString (): Buffer {
    const length = this.readLengthPrefix()

    return this.read(length)
  }

  /**
   * Read a variable-length buffer, but do not advance cursor position.
   */
  peekVarOctetString (): Buffer {
    this.bookmark()
    const value = this.readVarOctetString()
    this.restore()

    return value
  }

  /**
   * Skip a variable-length buffer.
   */
  skipVarOctetString (): void {
    const length = this.readLengthPrefix()

    this.skip(length)
  }

  /**
   * Read a given number of bytes.
   *
   * Returns this many bytes starting at the cursor position and advances the
   * cursor.
   *
   * @param bytes Number of bytes to read.
   */
  read (bytes: number): Buffer {
    this.ensureAvailable(bytes)

    const value = this.buffer.slice(this.cursor, this.cursor + bytes)
    this.cursor += bytes

    return value
  }

  /**
   * Read bytes, but do not advance cursor.
   *
   * @param bytes Number of bytes to read.
   */
  peek (bytes: number): Buffer {
    this.ensureAvailable(bytes)

    return this.buffer.slice(this.cursor, this.cursor + bytes)
  }

  /**
   * Skip a number of bytes.
   *
   * Advances the cursor by this many bytes.
   *
   * @param bytes Number of bytes to advance the cursor by.
   */
  skip (bytes: number): void {
    this.ensureAvailable(bytes)

    this.cursor += bytes
  }
}

export interface Reader {
  readUInt8 (): string
  readUInt16 (): string
  readUInt32 (): string
  readUInt64 (): string
  peekUInt8 (): string
  peekUInt16 (): string
  peekUInt32 (): string
  peekUInt64 (): string
  skipUInt8 (): void
  skipUInt16 (): void
  skipUInt32 (): void
  skipUInt64 (): void
  readInt8 (): string
  readInt16 (): string
  readInt32 (): string
  readInt64 (): string
  peekInt8 (): string
  peekInt16 (): string
  peekInt32 (): string
  peekInt64 (): string
  skipInt8 (): void
  skipInt16 (): void
  skipInt32 (): void
  skipInt64 (): void
  readUInt8Number (): number
  readUInt16Number (): number
  readUInt32Number (): number
  readUInt64Number (): number
  peekUInt8Number (): number
  peekUInt16Number (): number
  peekUInt32Number (): number
  peekUInt64Number (): number
  readInt8Number (): number
  readInt16Number (): number
  readInt32Number (): number
  readInt64Number (): number
  peekInt8Number (): number
  peekInt16Number (): number
  peekInt32Number (): number
  peekInt64Number (): number
  readUInt8Long (): Long
  readUInt16Long (): Long
  readUInt32Long (): Long
  readUInt64Long (): Long
  peekUInt8Long (): Long
  peekUInt16Long (): Long
  peekUInt32Long (): Long
  peekUInt64Long (): Long
  readInt8Long (): Long
  readInt16Long (): Long
  readInt32Long (): Long
  readInt64Long (): Long
  peekInt8Long (): Long
  peekInt16Long (): Long
  peekInt32Long (): Long
  peekInt64Long (): Long
}

// Create {read,peek,skip}UInt{8,16,32}{,Number,Long} shortcuts
['read', 'peek', 'skip'].forEach((verb) => {
  [1, 2, 4, 8].forEach((bytes) => {
    Reader.prototype[verb + 'UInt' + bytes * 8] = function () {
      return this[verb + 'UInt'](bytes)
    }

    Reader.prototype[verb + 'Int' + bytes * 8] = function () {
      return this[verb + 'Int'](bytes)
    }

    // No point if having typed skips
    if (verb !== 'skip') {
      Reader.prototype[verb + 'UInt' + bytes * 8 + 'Number'] = function () {
        return this[verb + 'UIntNumber'](bytes)
      }

      Reader.prototype[verb + 'Int' + bytes * 8 + 'Number'] = function () {
        return this[verb + 'IntNumber'](bytes)
      }

      Reader.prototype[verb + 'UInt' + bytes * 8 + 'Long'] = function () {
        return this[verb + 'UIntLong'](bytes)
      }

      Reader.prototype[verb + 'Int' + bytes * 8 + 'Long'] = function () {
        return this[verb + 'IntLong'](bytes)
      }
    }
  })
})
