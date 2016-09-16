'use strict'

const isInteger = require('core-js/library/fn/number/is-integer')

class Writer {
  constructor () {
    this.components = []
  }

  /**
   * Write a fixed-length unsigned integer to the stream.
   *
   * @param {Number} value Value to write. Must be in range for the given length.
   * @param {Number} length Number of bytes to encode this value as.
   */
  writeUInt (value, length) {
    if (!isInteger(value)) {
      throw new Error('UInt must be an integer')
    } else if (value < 0) {
      throw new Error('UInt must be positive')
    } else if (length <= 0) {
      throw new Error('UInt length must be greater than zero')
    } else if (value > Writer.MAX_SAFE_INTEGER) {
      throw new Error('UInt is larger than safe JavaScript range')
    } else if (value > Writer.UINT_RANGES[length]) {
      throw new Error('UInt ' + value + ' does not fit in ' + length + ' bytes')
    }

    const buffer = new Buffer(length)
    buffer.writeUIntBE(value, 0, length)
    this.write(buffer)
  }

  /**
   * Write a fixed-length signed integer to the stream.
   *
   * @param {Number} value Value to write. Must be in range for the given length.
   * @param {Number} length Number of bytes to encode this value as.
   */
  writeInt (value, length) {
    if (!isInteger(value)) {
      throw new Error('Int must be an integer')
    } else if (length <= 0) {
      throw new Error('Int length must be greater than zero')
    } else if (value > Writer.MAX_SAFE_INTEGER) {
      throw new Error('Int is larger than safe JavaScript range')
    } else if (value < Writer.MIN_SAFE_INTEGER) {
      throw new Error('Int is smaller than safe JavaScript range')
    } else if (value < Writer.INT_RANGES[length][0]) {
      throw new Error('Int ' + value + ' does not fit in ' + length + ' bytes')
    } else if (value > Writer.INT_RANGES[length][1]) {
      throw new Error('Int ' + value + ' does not fit in ' + length + ' bytes')
    }

    const buffer = new Buffer(length)
    buffer.writeIntBE(value, 0, length)
    this.write(buffer)
  }

  /**
   * Write a variable length unsigned integer to the stream.
   *
   * We need to first turn the integer into a buffer in big endian order, then
   * we write the buffer as an octet string.
   *
   * @param {Number} value Integer to represent.
   */
  writeVarUInt (value) {
    if (Buffer.isBuffer(value)) {
      // If the integer was already passed as a buffer, we can just treat it as
      // an octet string.
      this.writeVarOctetString(value)
      return
    } else if (!isInteger(value)) {
      throw new Error('UInt must be an integer')
    } else if (value < 0) {
      throw new Error('UInt must be positive')
    } else if (value > Writer.MAX_SAFE_INTEGER) {
      throw new Error('UInt is larger than safe JavaScript range')
    }

    const lengthOfValue = Math.ceil(value.toString(2).length / 8)
    const buffer = new Buffer(lengthOfValue)
    buffer.writeUIntBE(value, 0, lengthOfValue)

    this.writeVarOctetString(buffer)
  }

  /**
   * Write a variable length signed integer to the stream.
   *
   * We need to first turn the integer into a buffer in big endian order, then
   * we write the buffer as an octet string.
   *
   * @param {Number} value Integer to represent.
   */
  writeVarInt (value) {
    if (Buffer.isBuffer(value)) {
      // If the integer was already passed as a buffer, we can just treat it as
      // an octet string.
      this.writeVarOctetString(value)
      return
    } else if (!isInteger(value)) {
      throw new Error('Int must be an integer')
    } else if (value > Writer.MAX_SAFE_INTEGER) {
      throw new Error('Int is larger than safe JavaScript range')
    } else if (value < Writer.MIN_SAFE_INTEGER) {
      throw new Error('Int is smaller than safe JavaScript range')
    }

    const lengthDeterminingValue = (value < 0) ? 1 - value : value
    const lengthOfValue = Math.ceil((lengthDeterminingValue.toString(2).length + 1) / 8)
    const buffer = new Buffer(lengthOfValue)
    buffer.writeIntBE(value, 0, lengthOfValue)

    this.writeVarOctetString(buffer)
  }

  /**
   * Write a 64-bit unsigned integer.
   *
   * It is possible to pass a number to this method, however only if the number
   * is guaranteed to be smaller than Number.MAX_SAFE_INTEGER.
   *
   * Alternatively, the number may be passed as an array of two 32-bit words,
   * with the most significant word first.
   *
   * @param {Number|Array} A 64-bit integer as a number or of the form [high, low]
   */
  writeUInt64 (value) {
    if (isInteger(value) && value <= Writer.MAX_SAFE_INTEGER) {
      this.writeUInt32(Math.floor(value / 0x100000000))
      this.writeUInt32(value & 0xffffffff)
      return
    } else if (!Array.isArray(value) || value.length !== 2 ||
        !isInteger(value[0]) || !isInteger(value[1])) {
      throw new TypeError('Expected 64-bit integer as an array of two 32-bit words')
    }

    this.writeUInt32(value[0])
    this.writeUInt32(value[1])
  }

  /**
   * Write a fixed-length octet string.
   *
   * Mostly just a raw write, but this method enforces the length of the
   * provided buffer is correct.
   *
   * @param {Buffer} buffer Data to write.
   * @param {Number} length Length of data according to the format.
   */
  writeOctetString (buffer, length) {
    if (buffer.length !== length) {
      throw new Error('Incorrect length for octet string (actual: ' +
        buffer.length + ', expected: ' + length + ')')
    }
    this.write(buffer)
  }

  /**
   * Write a variable-length octet string.
   *
   * A variable-length octet string is a length-prefixed set of arbitrary bytes.
   *
   * @param {Buffer} buffer Contents of the octet string.
   */
  writeVarOctetString (buffer) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError('Expects a buffer')
    }

    const MSB = 0x80

    if (buffer.length <= 127) {
      // For buffers shorter than 128 bytes, we simply prefix the length as a
      // single byte.
      this.writeUInt8(buffer.length)
    } else {
      // For buffers longer than 128 bytes, we first write a single byte
      // containing the length of the length in bytes, with the most significant
      // bit set.
      const lengthOfLength = Math.ceil(buffer.length.toString(2).length / 8)
      this.writeUInt8(MSB | lengthOfLength)

      // Then we write the length of the buffer in that many bytes.
      this.writeUInt(buffer.length, lengthOfLength)
    }

    this.write(buffer)
  }

  /**
   * Write a series of raw bytes.
   *
   * Adds the given bytes to the output buffer.
   *
   * @param {Buffer} buffer Bytes to write.
   */
  write (buffer) {
    this.components.push(buffer)
  }

  /**
   * Return the resulting buffer.
   *
   * Returns the buffer containing the serialized data that was written using
   * this writer.
   *
   * @return {Buffer} Result data.
   */
  getBuffer () {
    // ST: The following debug statement is very useful, so I finally decided to
    // commit it...
    // console.log(this.components.map((x) => x.toString('hex')).join(' '))

    return Buffer.concat(this.components)
  }
}

// Largest value that can be written as a variable-length unsigned integer
Writer.MAX_SAFE_INTEGER = require('core-js/library/fn/number/max-safe-integer')
Writer.MIN_SAFE_INTEGER = require('core-js/library/fn/number/min-safe-integer')

Writer.UINT_RANGES = {
  1: 0xff,
  2: 0xffff,
  3: 0xffffff,
  4: 0xffffffff,
  5: 0xffffffffff,
  6: 0xffffffffffff
}

Writer.INT_RANGES = {
  1: [-0x80, 0x7f],
  2: [-0x8000, 0x7fff],
  3: [-0x800000, 0x7fffff],
  4: [-0x80000000, 0x7fffffff],
  5: [-0x8000000000, 0x7fffffffff],
  6: [-0x800000000000, 0x7fffffffffff]
}

// Create write(U)Int{8,16,32} shortcuts
;[1, 2, 4].forEach((bytes) => {
  Writer.prototype['writeUInt' + bytes * 8] = function (value) {
    this.writeUInt(value, bytes)
  }

  Writer.prototype['writeInt' + bytes * 8] = function (value) {
    this.writeInt(value, bytes)
  }
})

module.exports = Writer
