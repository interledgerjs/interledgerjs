import UnderflowError = require('../errors/underflow-error')
import ParseError = require('../errors/parse-error')

class Reader {
  // Most significant bit in a byte
  static HIGH_BIT = 0x80

  // Other bits in a byte
  static LOWER_SEVEN_BITS = 0x7F

  // Largest integer (in bytes) that is safely representable in JavaScript
  // => Math.floor(Number.MAX_SAFE_INTEGER.toString(2).length / 8)
  static MAX_INT_BYTES = 6

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
  static from (source: Buffer | Reader) {
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
  bookmark () {
    this.bookmarks.push(this.cursor)
  }

  /**
   * Pop the most recently bookmarked cursor position off the stack.
   */
  restore () {
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
  ensureAvailable (bytes: number) {
    if (this.buffer.length < (this.cursor + bytes)) {
      throw new UnderflowError('Tried to read ' + bytes + ' bytes, but only ' +
        (this.buffer.length - this.cursor) + ' bytes available')
    }
  }

  /**
   * Read a fixed-length unsigned big-endian integer.
   *
   * @param {number} length Length of the integer in bytes.
   * @return {number} Contents of next byte.
   */
  readUInt (length: number) {
    const value = this.peekUInt(length)
    this.cursor += length
    return value
  }

  /**
   * Look at a fixed-length unsigned integer, but don't advance the cursor.
   *
   * @param {number} length Length of the integer in bytes.
   * @return {number} Contents of the next byte.
   */
  peekUInt (length: number) {
    if (length === 0) {
      return 0
    }
    if (length < 0) {
      throw new Error('Tried to read integer with negative length (provided: ' +
        length + ')')
    }
    if (length > Reader.MAX_INT_BYTES) {
      throw new Error('Tried to read too large integer (requested: ' +
        length + ', max: ' + Reader.MAX_INT_BYTES + ')')
    }
    this.ensureAvailable(length)
    const value = this.buffer.readUIntBE(this.cursor, length)
    return value
  }

  /**
   * Advance cursor by length bytes.
   */
  skipUInt (length: number) {
    this.skip(length)
  }

  /**
   * Read a fixed-length signed big-endian integer.
   *
   * @param {number} length Length of the integer in bytes.
   * @return {number} Contents of next byte.
   */
  readInt (length: number) {
    const value = this.peekInt(length)
    this.cursor += length
    return value
  }

  /**
   * Look at a fixed-length signed integer, but don't advance the cursor.
   *
   * @param {number} length Length of the integer in bytes.
   * @return {number} Contents of the next byte.
   */
  peekInt (length: number) {
    if (length === 0) {
      return 0
    }
    if (length < 0) {
      throw new Error('Tried to read integer with negative length (provided: ' +
        length + ')')
    }
    if (length > Reader.MAX_INT_BYTES) {
      throw new Error('Tried to read too large integer (requested: ' +
        length + ', max: ' + Reader.MAX_INT_BYTES + ')')
    }
    this.ensureAvailable(length)
    const value = this.buffer.readIntBE(this.cursor, length)
    return value
  }

  /**
   * Advance cursor by length bytes.
   */
  skipInt (length: number) {
    this.skip(length)
  }

  /**
   * Read a 64-bit integer.
   *
   * @return {number[]} Integer in the form [high, low]
   */
  readUInt64 () {
    return [ this.readUInt32(), this.readUInt32() ]
  }

  /**
   * Look at a 64-bit integer, but don't advance the cursor.
   *
   * @return {number[]} Integer in the form [high, low]
   */
  peekUInt64 () {
    this.bookmark()
    const value = this.readUInt64()
    this.restore()
    return value
  }

  /**
   * Advance the cursor by eight bytes.
   */
  skipUInt64 () {
    this.skip(8)
  }

  /**
   * Read a variable-length unsigned integer at the cursor position.
   *
   * Return the integer as a number and advance the cursor accordingly.
   *
   * @return {number} Value of the integer.
   */
  readVarUInt () {
    const buffer = this.readVarOctetString()
    if (buffer.length > Reader.MAX_INT_BYTES) {
      throw new ParseError('UInt of length ' + buffer.length +
        ' too large to parse as integer (max: ' + Reader.MAX_INT_BYTES + ')')
    }

    if (buffer.length === 0) {
      throw new ParseError('UInt of length 0 is invalid')
    }

    return buffer.readUIntBE(0, buffer.length)
  }

  /**
   * Read the next variable-length unsigned integer, but don't advance the cursor.
   *
   * @return {number} Integer at the cursor position.
   */
  peekVarUInt () {
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
  skipVarUInt () {
    this.skipVarOctetString()
  }

  /**
   * Read a variable-length unsigned integer at the cursor position.
   *
   * Return the integer as a number and advance the cursor accordingly.
   *
   * @return {number} Value of the integer.
   */
  readVarInt () {
    const buffer = this.readVarOctetString()
    if (buffer.length > Reader.MAX_INT_BYTES) {
      throw new ParseError('Int of length ' + buffer.length +
        ' too large to parse as integer (max: ' + Reader.MAX_INT_BYTES + ')')
    }

    if (buffer.length === 0) {
      throw new ParseError('Int of length 0 is invalid')
    }

    return buffer.readIntBE(0, buffer.length)
  }

  /**
   * Read the next variable-length unsigned integer, but don't advance the cursor.
   *
   * @return {number} Integer at the cursor position.
   */
  peekVarInt () {
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
  skipVarInt () {
    this.skipVarOctetString()
  }

  /**
   * Read a fixed-length octet string.
   *
   * @param {number} length Length of the octet string.
   */
  readOctetString (length: number) {
    return this.read(length)
  }

  /**
   * Peek at a fixed length octet string.
   *
   * @param {number} length Length of the octet string.
   */
  peekOctetString (length: number) {
    return this.peek(length)
  }

  /**
   * Skip a fixed length octet string.
   *
   * @param {number} length Length of the octet string.
   */
  skipOctetString (length: number) {
    return this.skip(length)
  }

  /**
   * Read a length prefix.
   *
   * You shouldn't need this. Length prefixes are used internally by
   * variable-length octet strings and integers.
   *
   * @return {number} Length value.
   */
  readLengthPrefix () {
    const length = this.readUInt8()

    if (length & Reader.HIGH_BIT) {
      const lengthPrefixLength = length & Reader.LOWER_SEVEN_BITS
      const actualLength = this.readUInt(lengthPrefixLength)

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
   *
   * @return {Buffer} Contents of the octet string.
   */
  readVarOctetString () {
    const length = this.readLengthPrefix()

    return this.read(length)
  }

  /**
   * Read a variable-length buffer, but do not advance cursor position.
   *
   * @return {Buffer} Contents of the buffer.
   */
  peekVarOctetString () {
    this.bookmark()
    const value = this.readVarOctetString()
    this.restore()

    return value
  }

  /**
   * Skip a variable-length buffer.
   */
  skipVarOctetString () {
    const length = this.readLengthPrefix()

    return this.skip(length)
  }

  /**
   * Read a given number of bytes.
   *
   * Returns this many bytes starting at the cursor position and advances the
   * cursor.
   *
   * @param {number} bytes Number of bytes to read.
   * @return {Buffer} Contents of bytes read.
   */
  read (bytes: number) {
    this.ensureAvailable(bytes)

    const value = this.buffer.slice(this.cursor, this.cursor + bytes)
    this.cursor += bytes

    return value
  }

  /**
   * Read bytes, but do not advance cursor.
   *
   * @param {number} bytes Number of bytes to read.
   * @return {Buffer} Contents of bytes read.
   */
  peek (bytes: number) {
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
  skip (bytes: number) {
    this.ensureAvailable(bytes)

    this.cursor += bytes
  }
}

interface Reader {
  readUInt8(): number
  readUInt16(): number
  readUInt32(): number
  peekUInt8(): number
  peekUInt16(): number
  peekUInt32(): number
  skipUInt8(): number
  skipUInt16(): number
  skipUInt32(): number
  readInt8(): number
  readInt16(): number
  readInt32(): number
  peekInt8(): number
  peekInt16(): number
  peekInt32(): number
  skipInt8(): number
  skipInt16(): number
  skipInt32(): number
}

// Create {read,peek,skip}UInt{8,16,32} shortcuts
;['read', 'peek', 'skip'].forEach((verb) => {
  ;[1, 2, 4].forEach((bytes) => {
    Reader.prototype[verb + 'UInt' + bytes * 8] = function () {
      return this[verb + 'UInt'](bytes)
    }

    Reader.prototype[verb + 'Int' + bytes * 8] = function () {
      return this[verb + 'Int'](bytes)
    }
  })
})

export = Reader
