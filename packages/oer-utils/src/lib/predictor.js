'use strict'

/**
 * Writable stream which tracks the amount of data written.
 *
 * This class acts as a writable stream, but only does the minimum amount of
 * work necessary to count/predict the output size.
 */
class Predictor {
  constructor () {
    this.size = 0
  }

  /**
   * Add the size of a fixed-length integer to the predicted size.
   *
   * @params {Number} value Value of integer. Irrelevant here, but included in
   *   order to have the same interface as the Writer.
   * @params {Number} length Size of integer in bytes.
   */
  writeUInt (value, length) {
    this.size += length
  }

  /**
   * Calculate the size of a variable-length integer.
   *
   * A VARUINT is a variable length integer encoded as base128 where the highest
   * bit indicates that another byte is following. The first byte contains the
   * seven least significant bits of the number represented.
   *
   * @param {Number} value Integer to be encoded
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

    const length = Math.ceil(value.toString(2).length / 8)
    this.writeVarOctetString({ length })
  }

  /**
   * Skip bytes for a fixed-length octet string.
   *
   * Just an alias for skip. Included to provide consistency with Writer.
   *
   * @param {Buffer} buffer Data to write.
   * @param {Number} length Length of data according to the format.
   */
  writeOctetString (buffer, length) {
    this.skip(length)
  }

  /**
   * Calculate the size of a variable-length octet string.
   *
   * A variable-length octet string is a length-prefixed set of arbitrary bytes.
   *
   * @param {Buffer} value Contents of the octet string.
   */
  writeVarOctetString (buffer) {
    // Skip initial byte
    this.skip(1)

    // Skip separate length field if there is one
    if (buffer.length > 127) {
      const lengthOfLength = Math.ceil(buffer.length.toString(2).length / 8)
      this.skip(lengthOfLength)
    }

    this.skip(buffer.length)
  }

  /**
   * Pretend to write a series of bytes.
   *
   * @param {Buffer} Bytes to write.
   */
  write (bytes) {
    this.size += bytes.length
  }

  /**
   * Add this many bytes to the predicted size.
   *
   * @param {Number} Number of bytes to pretend to write.
   */
  skip (bytes) {
    this.size += bytes
  }

  /**
   * Get the size the buffer would have if this was a real writer.
   *
   * @return {Number} Size in bytes.
   */
  getSize () {
    return this.size
  }
}

// Create writeUInt{8,16,32,64} shortcuts
;[1, 2, 4, 8].forEach((bytes) => {
  Predictor.prototype['writeUInt' + bytes * 8] = function (value) {
    return this['writeUInt'](value, bytes)
  }
})

module.exports = Predictor
