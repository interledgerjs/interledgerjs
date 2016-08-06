'use strict'

const Writer = require('../writer')

const assert = require('chai').assert

describe('Writer', function () {
  describe('constructor', function () {
    it('should create a writer', function () {
      const writer = new Writer()

      assert.instanceOf(writer, Writer)
    })
  })

  describe('writeUInt', function () {
    it('when writing a zero byte integer, should throw', function () {
      const writer = new Writer()

      assert.throws(() => {
        writer.writeUInt(0, 0)
      }, 'UInt length must be greater than zero')
    })

    it('should write a one byte integer zero', function () {
      const writer = new Writer()

      writer.writeUInt(0, 1)

      assert.equal(writer.getBuffer().toString('hex'), '00')
    })

    it('should write a two byte integer', function () {
      const writer = new Writer()

      writer.writeUInt(258, 2)

      assert.equal(writer.getBuffer().toString('hex'), '0102')
    })

    it('when asked to write an integer that does not fit, should throw', function () {
      const writer = new Writer()

      assert.throws(() => {
        writer.writeUInt(256, 1)
      }, 'UInt 256 does not fit in 1 bytes')
    })

    it('when asked to write a negative integer, should throw', function () {
      const writer = new Writer()

      assert.throws(() => {
        writer.writeUInt(-1, 1)
      }, 'UInt must be positive')
    })

    it('when asked to write a non-integer, should throw', function () {
      const writer = new Writer()

      assert.throws(() => {
        writer.writeUInt(false, 1)
      }, 'UInt must be an integer')
    })
  })

  describe('writeVarUInt', function () {
    it('should write a zero', function () {
      const writer = new Writer()

      writer.writeVarUInt(0)

      assert.equal(writer.getBuffer().toString('hex'), '0100')
    })

    it('should write a one-byte integer', function () {
      const writer = new Writer()

      writer.writeVarUInt(16)

      assert.equal(writer.getBuffer().toString('hex'), '0110')
    })

    it('should write a two-byte integer', function () {
      const writer = new Writer()

      writer.writeVarUInt(259)

      assert.equal(writer.getBuffer().toString('hex'), '020103')
    })

    it('should write a four-byte integer', function () {
      const writer = new Writer()

      writer.writeVarUInt(0x01020305)

      assert.equal(writer.getBuffer().toString('hex'), '0401020305')
    })

    it('should write the largest possible number', function () {
      const writer = new Writer()

      writer.writeVarUInt(Number.MAX_SAFE_INTEGER)

      assert.equal(writer.getBuffer().toString('hex'), '071fffffffffffff')
    })

    it('when trying to write an unsafe integer, should throw', function () {
      const writer = new Writer()

      assert.throws(() => {
        writer.writeVarUInt(Number.MAX_SAFE_INTEGER + 1)
      }, 'UInt is too large')
    })

    it('when trying to write an eight-byte integer, should throw', function () {
      const writer = new Writer()

      assert.throws(() => {
        writer.writeVarUInt(0x0100000000000000)
      }, 'UInt is too large')
    })

    it('when trying to write a negative integer, should throw', function () {
      const writer = new Writer()

      assert.throws(() => {
        writer.writeVarUInt(-1)
      }, 'UInt must be positive')
    })

    it('when trying to write a non-integer, should throw', function () {
      const writer = new Writer()

      assert.throws(() => {
        writer.writeVarUInt(false)
      }, 'UInt must be an integer')
    })

    it('should accept a buffer to write', function () {
      const writer = new Writer()

      writer.writeVarUInt(new Buffer('010203040506070810', 'hex'))

      assert.equal(writer.getBuffer().toString('hex'), '09010203040506070810')
    })
  })

  describe('writeOctetString', function () {
    it('should write an empty octet string', function () {
      const writer = new Writer()

      writer.writeOctetString(new Buffer(0), 0)

      assert.equal(writer.getBuffer().toString('hex'), '')
    })

    it('should write an octet string of length 1', function () {
      const writer = new Writer()

      writer.writeOctetString(new Buffer('02', 'hex'), 1)

      assert.equal(writer.getBuffer().toString('hex'), '02')
    })

    it('should write an octet string of length 256', function () {
      const writer = new Writer()

      const buffer = new Buffer(256)
      buffer.fill(0xb0)
      writer.writeOctetString(buffer, 256)
      const result = writer.getBuffer()

      assert.equal(result.length, 256)
      assert.equal(result.toString('hex'), buffer.toString('hex'))
    })

    it('when writing an octet string of the wrong length, should throw', function () {
      const writer = new Writer()

      assert.throws(() => {
        writer.writeOctetString(new Buffer('02', 'hex'), 2)
      }, 'Incorrect length for octet string (actual: 1, expected: 2)')
    })
  })

  describe('writeVarOctetString', function () {
    it('should write an empty buffer', function () {
      const writer = new Writer()

      writer.writeVarOctetString(new Buffer(0))

      assert.equal(writer.getBuffer().toString('hex'), '00')
    })

    it('should write a buffer of length 1', function () {
      const writer = new Writer()

      writer.writeVarOctetString(new Buffer('b0', 'hex'))

      assert.equal(writer.getBuffer().toString('hex'), '01b0')
    })

    it('should write a buffer of length 256', function () {
      const writer = new Writer()

      const buffer = new Buffer(256)
      buffer.fill(0xb0)
      writer.writeVarOctetString(buffer)
      const result = writer.getBuffer()

      assert.equal(result.length, 259)
      assert.equal(result.toString('hex'), '820100' + buffer.toString('hex'))
    })

    it('when writing a non-buffer, should throw', function () {
      const writer = new Writer()

      assert.throws(() => {
        writer.writeVarOctetString(false)
      }, 'Expects a buffer')
    })
  })

  describe('write', function () {
    it('should write an empty octet string', function () {
      const writer = new Writer()

      writer.write(new Buffer(0))

      assert.equal(writer.getBuffer().toString('hex'), '')
    })

    it('should write an octet string of length 1', function () {
      const writer = new Writer()

      writer.write(new Buffer('02', 'hex'))

      assert.equal(writer.getBuffer().toString('hex'), '02')
    })

    it('should write an octet string of length 256', function () {
      const writer = new Writer()

      const buffer = new Buffer(256)
      buffer.fill(0xb0)
      writer.write(buffer)
      const result = writer.getBuffer()

      assert.equal(result.length, 256)
      assert.equal(result.toString('hex'), buffer.toString('hex'))
    })
  })

  describe('getBuffer', function () {
    it('should return the writer output', function () {
      const writer = new Writer()

      writer.writeVarUInt(256)
      const output = writer.getBuffer()

      assert.isTrue(Buffer.isBuffer(output))
      assert.equal(output.toString('hex'), '020100')
    })

    it('should return a new Buffer each time', function () {
      const writer = new Writer()

      writer.writeVarUInt(256)
      const output1 = writer.getBuffer()
      const output2 = writer.getBuffer()

      assert.isTrue(Buffer.isBuffer(output1))
      assert.isTrue(Buffer.isBuffer(output2))
      assert.equal(output1.toString('hex'), '020100')
      assert.equal(output2.toString('hex'), '020100')
      assert.notEqual(output1, output2)
    })
  })

  describe('writeUInt8', function () {
    it('should write an 8-bit integer', function () {
      const writer = new Writer()

      writer.writeUInt8(0xff)

      assert.equal(writer.getBuffer().toString('hex'), 'ff')
    })
  })

  describe('writeUInt16', function () {
    it('should write an 16-bit integer', function () {
      const writer = new Writer()

      writer.writeUInt16(0xff02)

      assert.equal(writer.getBuffer().toString('hex'), 'ff02')
    })
  })

  describe('writeUInt32', function () {
    it('should write an 32-bit integer', function () {
      const writer = new Writer()

      writer.writeUInt32(0xff020304)

      assert.equal(writer.getBuffer().toString('hex'), 'ff020304')
    })
  })

  describe('writeUInt64', function () {
    it('should write an 64-bit integer', function () {
      const writer = new Writer()

      writer.writeUInt64([0xff020304, 0x05060708])

      assert.equal(writer.getBuffer().toString('hex'), 'ff02030405060708')
    })

    it('should write an integer that is not formatted as an array', function () {
      const writer = new Writer()

      writer.writeUInt64(0xff0203040506)

      assert.equal(writer.getBuffer().toString('hex'), '0000ff0203040506')
    })

    it('when writing an unsafe integer, should throw', function () {
      const writer = new Writer()

      assert.throws(() => {
        writer.writeUInt64(Number.MAX_SAFE_INTEGER + 1)
      }, 'Expected 64-bit integer as an array of two 32-bit words')
    })
  })
})
