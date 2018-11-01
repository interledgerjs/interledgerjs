import { isInteger } from './util'
import BigNumber from 'bignumber.js'

/**
 * Writable stream which tracks the amount of data written.
 *
 * This class acts as a writable stream, but only does the minimum amount of
 * work necessary to count/predict the output size.
 */
class Predictor {
  size: number
  components: Buffer[]

  constructor () {
    this.size = 0
    this.components = []
  }

  /**
   * Add the size of a fixed-length unsigned integer to the predicted size.
   */
  writeUInt (value: BigNumber.Value, length: number) {
    this.size += length
  }

  /**
   * Add the size of a fixed-length integer to the predicted size.
   */
  writeInt (value: BigNumber.Value, length: number) {
    this.size += length
  }

  /**
   * Calculate the size of a variable-length unsigned integer.
   */
  writeVarUInt (_value: BigNumber.Value) {
    if (!isInteger(_value)) {
      throw new Error('UInt must be an integer')
    }
    const value = new BigNumber(_value)

    if (value.isNegative()) {
      throw new Error('UInt must be positive')
    }

    const lengthOfValue = Math.ceil(value.toString(16).length / 2)
    this.skipVarOctetString(lengthOfValue)
  }

  /**
   * Calculate the size of a variable-length integer.
   */
  writeVarInt (_value: BigNumber.Value) {
    if (!isInteger(_value)) {
      throw new Error('UInt must be an integer')
    }
    const value = new BigNumber(_value)

    const lengthOfValue = Math.ceil(value.toString(16).length / 2)
    this.skipVarOctetString(lengthOfValue)
  }

  /**
   * Skip bytes for a fixed-length octet string.
   */
  writeOctetString (buffer: Buffer, length: number) {
    this.skip(length)
  }

  /**
   * Calculate the size of a variable-length octet string.
   */
  writeVarOctetString (buffer: Buffer) {
    this.skipVarOctetString(buffer.length)
  }

  /**
   * Skip bytes for the length prefix.
   */
  prependLengthPrefix (): void {
    const length = this.size

    // Skip initial byte
    this.skip(1)

    // Skip separate length field if there is one
    if (length > 127) {
      const lengthOfLength = Math.ceil(length.toString(2).length / 8)
      this.skip(lengthOfLength)
    }
  }

  /**
   * Pretend to write a series of bytes.
   *
   * @param {Buffer} Bytes to write.
   */
  write (bytes: Buffer) {
    this.size += bytes.length
  }

  /**
   * Add this many bytes to the predicted size.
   *
   * @param {Number} Number of bytes to pretend to write.
   */
  skip (bytes: number) {
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

  /**
   * Dummy function just to mimic Writer API
   */
  getBuffer (): Buffer {
    return Buffer.alloc(0)
  }

  private skipVarOctetString (length: number) {
    // Skip initial byte
    this.skip(1)

    // Skip separate length field if there is one
    if (length > 127) {
      const lengthOfLength = Math.ceil(length.toString(2).length / 8)
      this.skip(lengthOfLength)
    }

    this.skip(length)
  }
}

interface Predictor {
  writeUInt8 (value: number): undefined
  writeUInt16 (value: number): undefined
  writeUInt32 (value: number): undefined
  writeUInt64 (value: number): undefined
  writeInt8 (value: number): undefined
  writeInt16 (value: number): undefined
  writeInt32 (value: number): undefined
  writeInt64 (value: number): undefined
}

// Create writeUInt{8,16,32,64} shortcuts
[1, 2, 4, 8].forEach((bytes) => {
  Predictor.prototype['writeUInt' + bytes * 8] = function (value: number) {
    return this.writeUInt(value, bytes)
  }

  Predictor.prototype['writeInt' + bytes * 8] = function (value: number) {
    return this.writeUInt(value, bytes)
  }
})

export default Predictor
