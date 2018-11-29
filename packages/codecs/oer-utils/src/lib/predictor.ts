import {
  isInteger,
  getUIntBufferSize,
  getIntBufferSize,
  getBigUIntBufferSize,
  getBigIntBufferSize
} from './util'
import BigNumber from 'bignumber.js'
import { WriterInterface } from './writer'

/**
 * Writable stream which tracks the amount of data written.
 *
 * This class acts as a writable stream, but only does the minimum amount of
 * work necessary to count/predict the output size.
 */
class Predictor implements WriterInterface {
  private size: number

  constructor () {
    this.size = 0
  }

  get length (): number {
    return this.size
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

    let lengthOfValue
    if (typeof _value === 'number') {
      if (_value < 0) {
        throw new Error('UInt must be positive')
      }
      // Fast path for numbers.
      lengthOfValue = getUIntBufferSize(_value)
    } else {
      // Don't clone an existing BigNumber, since it will not be modified.
      const value = BigNumber.isBigNumber(_value) ? _value as BigNumber : new BigNumber(_value)

      if (value.isNegative()) {
        throw new Error('UInt must be positive')
      }

      lengthOfValue = getBigUIntBufferSize(value)
    }

    this.skipVarOctetString(lengthOfValue)
  }

  /**
   * Calculate the size of a variable-length integer.
   */
  writeVarInt (_value: BigNumber.Value) {
    if (!isInteger(_value)) {
      throw new Error('UInt must be an integer')
    }

    let lengthOfValue
    if (typeof _value === 'number') {
      lengthOfValue = getIntBufferSize(_value)
    } else {
      const value = BigNumber.isBigNumber(_value) ? _value as BigNumber : new BigNumber(_value)
      lengthOfValue = getBigIntBufferSize(value)
    }

    this.skipVarOctetString(lengthOfValue)
  }

  /**
   * Skip bytes for a fixed-length octet string.
   */
  writeOctetString (buffer: Buffer, length: number) {
    if (buffer.length !== length) {
      throw new Error('Incorrect length for octet string (actual: ' +
        buffer.length + ', expected: ' + length + ')')
    }
    this.skip(length)
  }

  /**
   * Skip bytes for a variable-length octet string.
   */
  writeVarOctetString (buffer: Buffer) {
    this.skipVarOctetString(buffer.length)
  }

  /**
   * Skip bytes for a variable-length octet string.
   */
  createVarOctetString (length: number): WriterInterface {
    this.skipVarOctetString(length)
    return new Predictor()
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

  static measureVarOctetString (length: number): number {
    // Skip initial byte
    let total = 1

    // Skip separate length field if there is one
    if (length > 127) {
      const lengthOfLength = getUIntBufferSize(length)
      total += lengthOfLength
    }

    total += length
    return total
  }

  private skipVarOctetString (length: number) {
    this.skip(Predictor.measureVarOctetString(length))
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
