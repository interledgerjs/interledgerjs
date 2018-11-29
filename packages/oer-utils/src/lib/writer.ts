import {
  isInteger,
  bigNumberToBuffer,
  MAX_SAFE_BYTES,
  getBigIntBufferSize,
  getBigUIntBufferSize,
  getIntBufferSize,
  getUIntBufferSize
} from './util'
import BigNumber from 'bignumber.js'

class Writer implements WriterInterface {
  // Largest value that can be written as a variable-length unsigned integer
  static MAX_SAFE_INTEGER: number = 0x1fffffffffffff
  static MIN_SAFE_INTEGER: number = -0x1fffffffffffff
  static MIN_BUFFER_SIZE: number = 32

  // The UINT_RANGES and INT_RANGES are only used up to util.MAX_SAFE_BYTES.
  // After that the buffer length is determined using getUIntBufferSize and
  // getIntBufferSize.
  static UINT_RANGES = {
    1: 0xff,
    2: 0xffff,
    3: 0xffffff,
    4: 0xffffffff,
    5: 0xffffffffff,
    6: 0xffffffffffff
  }

  static INT_RANGES = {
    1: [-0x80, 0x7f],
    2: [-0x8000, 0x7fff],
    3: [-0x800000, 0x7fffff],
    4: [-0x80000000, 0x7fffffff],
    5: [-0x8000000000, 0x7fffffffff],
    6: [-0x800000000000, 0x7fffffffffff]
  }

  private buffer: Buffer
  private _offset: number
  private strict: boolean

  /**
   * @param value Optional. Either a Buffer to use, or a capacity to allocate. If an explicit capacity or buffer is passed, the writer will throw if more bytes are written.
   */
  constructor (value?: number | Buffer) {
    if (Buffer.isBuffer(value)) {
      this.buffer = value
      this.strict = true
    } else { // capacity
      this.buffer = Buffer.alloc(value || 0)
      this.strict = typeof value === 'number'
    }
    this._offset = 0
  }

  get length (): number {
    return this._offset
  }

  /**
   * Write a fixed-length unsigned integer to the stream.
   *
   * @param {number | string | BigNumber} value Value to write. Must be in range for the given length.
   * @param length Number of bytes to encode this value as.
   */
  writeUInt (_value: BigNumber.Value | number[], length: number): void {
    if (Array.isArray(_value)) {
      this.writeUInt32(_value[0])
      this.writeUInt32(_value[1])
      return
    }
    if (!isInteger(_value)) {
      throw new Error('UInt must be an integer')
    } else if (typeof _value === 'number' && _value > Writer.MAX_SAFE_INTEGER) {
      throw new Error('UInt is larger than safe JavaScript range (try using BigNumbers instead)')
    } else if (length <= 0) {
      throw new Error('UInt length must be greater than zero')
    }

    if (length <= MAX_SAFE_BYTES) {
      const value = Number(_value)
      if (value < 0) {
        throw new Error('UInt must be positive')
      } else if (value > Writer.UINT_RANGES[length]) {
        throw new Error(`UInt ${value} does not fit in ${length} bytes`)
      }

      const offset = this.advance(length)
      this.buffer.writeUIntBE(value, offset, length)
    } else {
      const value = BigNumber.isBigNumber(_value) ? _value as BigNumber : new BigNumber(_value)
      if (value.isLessThan(0)) {
        throw new Error('UInt must be positive')
      } else if (length < getBigUIntBufferSize(value)) {
        throw new Error(`UInt ${value} does not fit in ${length} bytes`)
      }

      this.write(bigNumberToBuffer(value, length))
    }
  }

  /**
   * Write a fixed-length signed integer to the stream.
   *
   * @param {number | string | BigNumber} value Value to write. Must be in range for the given length.
   * @param length Number of bytes to encode this value as.
   */
  writeInt (_value: BigNumber.Value, length: number): void {
    if (!isInteger(_value)) {
      throw new Error('Int must be an integer')
    } else if (length <= 0) {
      throw new Error('Int length must be greater than zero')
    } else if (typeof _value === 'number' && _value > Writer.MAX_SAFE_INTEGER) {
      throw new Error('Int is larger than safe JavaScript range (try using BigNumbers instead)')
    } else if (typeof _value === 'number' && _value < Writer.MIN_SAFE_INTEGER) {
      throw new Error('Int is smaller than safe JavaScript range (try using BigNumbers instead)')
    }

    if (length <= MAX_SAFE_BYTES) {
      const value = Number(_value)
      if (value < Writer.INT_RANGES[length][0] || value > Writer.INT_RANGES[length][1]) {
        throw new Error('Int ' + value + ' does not fit in ' + length + ' bytes')
      }

      const offset = this.advance(length)
      this.buffer.writeIntBE(value, offset, length)
    } else {
      const value = BigNumber.isBigNumber(_value) ? _value as BigNumber : new BigNumber(_value)
      if (length < getBigIntBufferSize(value)) {
        throw new Error('Int ' + value + ' does not fit in ' + length + ' bytes')
      }

      const valueToWrite = value.isLessThan(0) ? new BigNumber(256).exponentiatedBy(length).plus(value) : value
      this.write(bigNumberToBuffer(valueToWrite, length))
    }
  }

  /**
   * Write a variable length unsigned integer to the stream.
   *
   * We need to first turn the integer into a buffer in big endian order, then
   * we write the buffer as an octet string.
   *
   * @param {number | string | BigNumber | Buffer} value Integer to represent.
   */
  writeVarUInt (_value: BigNumber.Value | Buffer): void {
    if (Buffer.isBuffer(_value)) {
      // If the integer was already passed as a buffer, we can just treat it as
      // an octet string.
      this.writeVarOctetString(_value)
      return
    } else if (!isInteger(_value)) {
      throw new Error('UInt must be an integer')
    }

    let value
    let lengthOfValue
    if (typeof _value === 'number') {
      value = _value
      lengthOfValue = getUIntBufferSize(value)
    } else {
      value = BigNumber.isBigNumber(_value) ? _value as BigNumber : new BigNumber(_value)
      lengthOfValue = getBigUIntBufferSize(value)
    }

    this.createVarOctetString(lengthOfValue).writeUInt(value, lengthOfValue)
  }

  /**
   * Write a variable length signed integer to the stream.
   *
   * We need to first turn the integer into a buffer in big endian order, then
   * we write the buffer as an octet string.
   *
   * @param {number | string | BigNumber | Buffer} value Integer to represent.
   */
  writeVarInt (_value: BigNumber.Value | Buffer): void {
    if (Buffer.isBuffer(_value)) {
      // If the integer was already passed as a buffer, we can just treat it as
      // an octet string.
      this.writeVarOctetString(_value)
      return
    } else if (!isInteger(_value)) {
      throw new Error('Int must be an integer')
    } else if (typeof _value === 'number' && _value > Writer.MAX_SAFE_INTEGER) {
      throw new Error('Int is larger than safe JavaScript range')
    } else if (typeof _value === 'number' && _value < Writer.MIN_SAFE_INTEGER) {
      throw new Error('Int is smaller than safe JavaScript range')
    }

    let value
    let lengthOfValue
    if (typeof _value === 'number') {
      value = _value
      lengthOfValue = getIntBufferSize(value)
    } else {
      value = BigNumber.isBigNumber(_value) ? _value as BigNumber : new BigNumber(_value)
      lengthOfValue = getBigIntBufferSize(value)
    }

    this.createVarOctetString(lengthOfValue).writeInt(value, lengthOfValue)
  }

  /**
   * Write a fixed-length octet string.
   *
   * Mostly just a raw write, but this method enforces the length of the
   * provided buffer is correct.
   *
   * @param buffer Data to write.
   * @param length Length of data according to the format.
   */
  writeOctetString (buffer: Buffer, length: number): void {
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
   * @param buffer Contents of the octet string.
   */
  writeVarOctetString (buffer: Buffer): void {
    if (Buffer.isBuffer(buffer)) {
      this._writeLengthPrefix(buffer.length)
      this.write(buffer)
    } else {
      throw new TypeError('Expects a buffer')
    }
  }

  /**
   * Write an OER-encoded variable-length octet string with the provided length.
   *
   * The returned Writer is only valid until another method is called on the
   * parent writer, since the buffer may be replaced.
   *
   * Writing more than `length` bytes will throw.
   *
   * @param length Length of the octet string.
   */
  createVarOctetString (length: number): Writer {
    if (length < 0) {
      throw new Error('length must be non-negative')
    }
    this._writeLengthPrefix(length)
    const offset = this.advance(length)
    const slice = this.buffer.slice(offset, offset + length)
    return new Writer(slice)
  }

  private _writeLengthPrefix (length: number): void {
    const MSB = 0x80
    if (length <= 127) {
      // For buffers shorter than 128 bytes, we simply prefix the length as a
      // single byte.
      this.writeUInt8(length)
    } else {
      // For buffers longer than 128 bytes, we first write a single byte
      // containing the length of the length in bytes, with the most significant
      // bit set.
      const lengthOfLength = getUIntBufferSize(length)
      this.writeUInt8(MSB | lengthOfLength)

      // Then we write the length of the buffer in that many bytes.
      this.writeUInt(length, lengthOfLength)
    }
  }

  /**
   * Write a series of raw bytes.
   *
   * Adds the given bytes to the output buffer.
   *
   * @param buffer Bytes to write.
   */
  write (buffer: Buffer): void {
    const offset = this.advance(buffer.length)
    buffer.copy(this.buffer, offset)
  }

  /**
   * Returns the buffer containing the serialized data that was written using
   * this writer.
   */
  getBuffer (): Buffer {
    // ST: The following debug statement is very useful, so I finally decided to
    // commit it...
    // console.log(this.components.map((x) => x.toString('hex')).join(' '))

    return this.buffer.slice(0, this._offset)
  }

  /**
   * Ensure that the buffer has the capacity to fit `advanceBy` bytes, reallocating
   * a larger buffer if necessary.
   */
  private advance (advanceBy: number): number {
    const srcOffset = this._offset
    const minCapacity = srcOffset + advanceBy
    if (minCapacity <= this.buffer.length) {
      // Fast path: the buffer already has the capacity for the new data.
      this._offset += advanceBy
      return srcOffset
    }

    if (this.strict) {
      throw new Error('writer cannot exceed capacity')
    }

    let capacity = this.buffer.length || Writer.MIN_BUFFER_SIZE
    while (capacity < minCapacity) capacity *= 2

    const newBuffer = Buffer.alloc(capacity)
    if (this.buffer.length) {
      this.buffer.copy(newBuffer)
    }
    this.buffer = newBuffer
    this._offset += advanceBy
    return srcOffset
  }
}

interface Writer {
  writeUInt8 (value: BigNumber.Value): undefined
  writeUInt16 (value: BigNumber.Value): undefined
  writeUInt32 (value: BigNumber.Value): undefined
  writeUInt64 (value: BigNumber.Value | number[]): undefined
  writeInt8 (value: BigNumber.Value): undefined
  writeInt16 (value: BigNumber.Value): undefined
  writeInt32 (value: BigNumber.Value): undefined
  writeInt64 (value: BigNumber.Value): undefined
}

// Create write(U)Int{8,16,32,64} shortcuts
[1, 2, 4, 8].forEach((bytes) => {
  Writer.prototype['writeUInt' + bytes * 8] = function (value: number) {
    this.writeUInt(value, bytes)
  }

  Writer.prototype['writeInt' + bytes * 8] = function (value: number) {
    this.writeInt(value, bytes)
  }
})

export interface WriterInterface {
  readonly length: number
  writeUInt (_value: BigNumber.Value, length: number): void
  writeInt (_value: BigNumber.Value, length: number): void
  writeVarUInt (_value: BigNumber.Value | Buffer): void
  writeVarInt (_value: BigNumber.Value | Buffer): void
  writeOctetString (buffer: Buffer, length: number): void
  writeVarOctetString (buffer: Buffer): void
  createVarOctetString (length: number): WriterInterface
  write (buffer: Buffer): void

  writeUInt8 (value: BigNumber.Value): undefined
  writeUInt16 (value: BigNumber.Value): undefined
  writeUInt32 (value: BigNumber.Value): undefined
  writeUInt64 (value: BigNumber.Value | number[]): undefined
  writeInt8 (value: BigNumber.Value): undefined
  writeInt16 (value: BigNumber.Value): undefined
  writeInt32 (value: BigNumber.Value): undefined
  writeInt64 (value: BigNumber.Value): undefined
}

export default Writer
