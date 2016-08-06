'use strict'

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
    if (!Number.isInteger(value)) {
      throw new Error('UInt must be an integer')
    } else if (value < 0) {
      throw new Error('UInt must be positive')
    } else if (value.toString(2).length > length * 8) {
      throw new Error('UInt ' + value + ' does not fit in ' + length + ' bytes')
    }

    const buffer = new Buffer(length)
    buffer.writeUIntBE(value, 0, length)
    this.write(buffer)
  }

  /**
   * Write a variable length integer to the stream.
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
    } else if (!Number.isInteger(value)) {
      throw new Error('UInt must be an integer')
    } else if (value < 0) {
      throw new Error('UInt must be positive')
    }

    const lengthOfValue = Math.ceil(value.toString(2).length / 8)
    const buffer = new Buffer(lengthOfValue)
    buffer.writeUIntBE(value, 0, lengthOfValue)

    this.writeVarOctetString(buffer)
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

// Create writeUInt{8,16,32,64} shortcuts
;[1, 2, 4, 8].forEach((bytes) => {
  Writer.prototype['writeUInt' + bytes * 8] = function (value) {
    this.writeUInt(value, bytes)
  }
})

module.exports = Writer
