import UnderflowError from '../errors/underflow-error'
import ParseError from '../errors/parse-error'
import BigNumber from 'bignumber.js'
import { bufferToBigNumber } from './util'

class Reader {
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
   * @param {Reader|Buffer} source Source of binary data.
   * @return {Reader} Instance of Reader
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
    this.cursor = this.bookmarks.pop()!
  }

  /**
   * Ensure this number of bytes is buffered.
   *
   * This method checks that the given number of bytes is buffered and available
   * for reading. If insufficient bytes are available, the method throws an
   * `UnderflowError`.
   *
   * @param {number} bytes Number of bytes that should be available.
   */
  ensureAvailable (bytes: number): void {
    if (this.buffer.length < (this.cursor + bytes)) {
      throw new UnderflowError('Tried to read ' + bytes + ' bytes, but only ' +
        (this.buffer.length - this.cursor) + ' bytes available')
    }
  }

  /**
   * Read a fixed-length unsigned big-endian integer.
   *
   * @param {number} length Length of the integer in bytes.
   */
  readUInt (length: number): BigNumber {
    const value = this.peekUInt(length)
    this.cursor += length
    return value
  }

  /**
   * Look at a fixed-length unsigned integer, but don't advance the cursor.
   *
   * @param {number} length Length of the integer in bytes.
   */
  peekUInt (length: number): BigNumber {
    if (length === 0) {
      return new BigNumber(0)
    } else if (length < 0) {
      throw new Error('Tried to read integer with negative length (provided: ' +
        length + ')')
    } else if (length > 8) {
      throw new Error('UInts longer than 8 bytes must be encoded as VarUInts')
    }

    return bufferToBigNumber(this.peek(length))
  }

  /**
   * Advance cursor by length bytes.
   */
  skipUInt (length: number): void {
    this.skip(length)
  }

  /**
   * Read a fixed-length signed big-endian integer.
   *
   * @param {number} length Length of the integer in bytes.
   * @return {BigNumber} Contents of next byte(s).
   */
  readInt (length: number): BigNumber {
    const value = this.peekInt(length)
    this.cursor += length
    return value
  }

  /**
   * Look at a fixed-length signed integer, but don't advance the cursor.
   *
   * @param {number} length Length of the integer in bytes.
   */
  peekInt (length: number): BigNumber {
    if (length === 0) {
      return new BigNumber(0)
    } else if (length < 0) {
      throw new Error('Tried to read integer with negative length (provided: ' +
        length + ')')
    } else if (length > 8) {
      throw new Error('Ints longer than 8 bytes must be encoded as VarInts')
    }

    const value = bufferToBigNumber(this.peek(length))

    const maxValue = new BigNumber(256).exponentiatedBy(length).minus(1)
    if (value.isLessThan(maxValue.dividedBy(2))) {
      return value
    } else {
      return value.minus(maxValue).minus(1)
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
  readVarUInt (): BigNumber {
    const buffer = this.readVarOctetString()
    if (buffer.length === 0) {
      throw new ParseError('UInt of length 0 is invalid')
    }

    return bufferToBigNumber(buffer)
  }

  /**
   * Read the next variable-length unsigned integer, but don't advance the cursor.
   */
  peekVarUInt (): BigNumber {
    this.bookmark()
    const value = this.readVarUInt()
    this.restore()

    return value
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
  readVarInt (): BigNumber {
    const buffer = this.readVarOctetString()

    if (buffer.length === 0) {
      throw new ParseError('Int of length 0 is invalid')
    }

    const value = bufferToBigNumber(buffer)

    const maxValue = new BigNumber(256).exponentiatedBy(buffer.length).minus(1)
    if (value.isLessThan(maxValue.dividedBy(2))) {
      return value
    } else {
      return value.minus(maxValue).minus(1)
    }
  }

  /**
   * Read the next variable-length unsigned integer, but don't advance the cursor.
   */
  peekVarInt (): BigNumber {
    this.bookmark()
    const value = this.readVarInt()
    this.restore()

    return value
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
   * @param {number} length Length of the octet string.
   */
  readOctetString (length: number): Buffer {
    return this.read(length)
  }

  /**
   * Peek at a fixed length octet string.
   *
   * @param {number} length Length of the octet string.
   */
  peekOctetString (length: number): Buffer {
    return this.peek(length)
  }

  /**
   * Skip a fixed length octet string.
   *
   * @param {number} length Length of the octet string.
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
    const length = this.readUInt8().toNumber()

    if (length & Reader.HIGH_BIT) {
      const lengthPrefixLength = length & Reader.LOWER_SEVEN_BITS
      const actualLength = this.readUInt(lengthPrefixLength).toNumber()

      // Reject lengths that could have been encoded with a shorter prefix
      const minLength = Math.max(128, 1 << ((lengthPrefixLength - 1) * 8))
      if (actualLength < minLength) {
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
   * @param {number} bytes Number of bytes to read.
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
   * @param {number} bytes Number of bytes to read.
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
   * @param {number} bytes Number of bytes to advance the cursor by.
   */
  skip (bytes: number): void {
    this.ensureAvailable(bytes)

    this.cursor += bytes
  }
}

interface Reader {
  readUInt8 (): BigNumber
  readUInt16 (): BigNumber
  readUInt32 (): BigNumber
  readUInt64 (): BigNumber
  peekUInt8 (): BigNumber
  peekUInt16 (): BigNumber
  peekUInt32 (): BigNumber
  peekUInt64 (): BigNumber
  skipUInt8 (): void
  skipUInt16 (): void
  skipUInt32 (): void
  skipUInt64 (): void
  readInt8 (): BigNumber
  readInt16 (): BigNumber
  readInt32 (): BigNumber
  readInt64 (): BigNumber
  peekInt8 (): BigNumber
  peekInt16 (): BigNumber
  peekInt32 (): BigNumber
  peekInt64 (): BigNumber
  skipInt8 (): void
  skipInt16 (): void
  skipInt32 (): void
  skipInt64 (): void
}

// Create {read,peek,skip}UInt{8,16,32} shortcuts
['read', 'peek', 'skip'].forEach((verb) => {
  [1, 2, 4, 8].forEach((bytes) => {
    Reader.prototype[verb + 'UInt' + bytes * 8] = function () {
      return this[verb + 'UInt'](bytes)
    }

    Reader.prototype[verb + 'Int' + bytes * 8] = function () {
      return this[verb + 'Int'](bytes)
    }
  })
})

export default Reader
