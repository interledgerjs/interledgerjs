'use strict'

const UnderflowError = require('../errors/underflow-error')
const ParseError = require('../errors/parse-error')

class Reader {
  constructor (buffer) {
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
  static from (source) {
    if (Buffer.isBuffer(source)) {
      return new Reader(source)
    } else if (source instanceof Reader) {
      return source
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
    this.cursor = this.bookmarks.pop()
  }

  /**
   * Ensure this number of bytes is buffered.
   *
   * This method checks that the given number of bytes is buffered and available
   * for reading. If insufficient bytes are available, the method throws an
   * `UnderflowError`.
   *
   * @param {Number} bytes Number of bytes that should be available.
   */
  ensureAvailable (bytes) {
    if (this.buffer.length < (this.cursor + bytes)) {
      throw new UnderflowError('Tried to read ' + bytes + ' bytes, but only ' +
        (this.buffer.length - this.cursor) + ' bytes available')
    }
  }

  /**
   * Read a fixed-length big-endian integer.
   *
   * @param {Number} length Length of the integer in bytes.
   * @return {Number} Contents of next byte.
   */
  readUInt (length) {
    if (length > Reader.MAX_INT_BYTES) {
      throw new Error('Tried too read too large integer (requested: ' +
        length + ', max: ' + Reader.MAX_INT_BYTES + ')')
    }
    this.ensureAvailable(length)
    const value = this.buffer.readUIntBE(this.cursor, length)
    this.cursor += length
    return value
  }

  /**
   * Look at a fixed-length integer, but don't advance the cursor.
   *
   * @param {Number} length Length of the integer in bytes.
   * @return {Number} Contents of the next byte.
   */
  peekUInt (length) {
    if (length > Reader.MAX_INT_BYTES) {
      throw new Error('Tried too read too large integer (requested: ' +
        length + ', max: ' + Reader.MAX_INT_BYTES + ')')
    }
    this.ensureAvailable(length)
    const value = this.buffer.readUIntBE(this.cursor, length)
    return value
  }

  /**
   * Advance cursor by length bytes.
   */
  skipUInt (length) {
    this.skip(length)
  }

  /**
   * Read a variable-length integer at the cursor position.
   *
   * Return the integer as a number and advance the cursor accordingly.
   *
   * @return {Number} Value of the integer.
   */
  readVarUInt () {
    const buffer = this.readVarOctetString()
    if (buffer.length > Reader.MAX_INT_BYTES) {
      throw new ParseError('UInt of length ' + buffer.length +
        'too large to parse as integer (max: ' + Reader.MAX_INT_BYTES + ')')
    }

    return buffer.readUIntBE(0, buffer.length)
  }

  /**
   * Read the next variable-length integer, but don't advance the cursor.
   *
   * @return {Number} Integer at the cursor position.
   */
  peekVarUInt () {
    this.bookmark()
    const value = this.readVarUInt()
    this.restore()

    return value
  }

  /**
   * Skip past the variable-length integer at the cursor position.
   *
   * Since variable integers are encoded the same way as octet strings, this
   * method is equivalent to skipVarOctetString.
   */
  skipVarUInt () {
    this.skipVarOctetString()
  }

  /**
   * Read a fixed-length octet string.
   *
   * @param {Number} length Length of the octet string.
   */
  readOctetString (length) {
    return this.read(length)
  }

  /**
   * Peek at a fixed length octet string.
   *
   * @param {Number} length Length of the octet string.
   */
  peekOctetString (length) {
    return this.peek(length)
  }

  /**
   * Skip a fixed length octet string.
   *
   * @param {Number} length Length of the octet string.
   */
  skipOctetString (length) {
    return this.skip(length)
  }

  /**
   * Read a length prefix.
   *
   * You shouldn't need this. Length prefixes are used internally by
   * variable-length octet strings and integers.
   *
   * @return {Number} Length value.
   */
  readLengthPrefix () {
    const length = this.readUInt8()

    if (length & Reader.HIGH_BIT) {
      return this.readUInt(length & Reader.LOWER_SEVEN_BITS)
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
   * @param {Number} bytes Number of bytes to read.
   * @return {Buffer} Contents of bytes read.
   */
  read (bytes) {
    this.ensureAvailable(bytes)

    const value = this.buffer.slice(this.cursor, this.cursor + bytes)
    this.cursor += bytes

    return value
  }

  /**
   * Read bytes, but do not advance cursor.
   *
   * @param {Number} bytes Number of bytes to read.
   * @return {Buffer} Contents of bytes read.
   */
  peek (bytes) {
    this.ensureAvailable(bytes)

    return this.buffer.slice(this.cursor, this.cursor + bytes)
  }

  /**
   * Skip a number of bytes.
   *
   * Advances the cursor by this many bytes.
   *
   * @param {Number} bytes Number of bytes to advance the cursor by.
   */
  skip (bytes) {
    this.ensureAvailable(bytes)

    this.cursor += bytes
  }
}

// Most significant bit in a byte
Reader.HIGH_BIT = 0x80

// Other bits in a byte
Reader.LOWER_SEVEN_BITS = 0x7F

// Largest integer (in bytes) that is safely representable in JavaScript
// => Math.floor(Number.MAX_SAFE_INTEGER.toString(2).length / 8)
Reader.MAX_INT_BYTES = 6

// Create {read,peek,skip}UInt{8,16,32,64} shortcuts
;['read', 'peek', 'skip'].forEach((verb) => {
  ;[1, 2, 4, 8].forEach((bytes) => {
    Reader.prototype[verb + 'UInt' + bytes * 8] = function () {
      return this[verb + 'UInt'](bytes)
    }
  })
})

module.exports = Reader
