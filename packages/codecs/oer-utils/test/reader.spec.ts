import Reader = require('../src/lib/reader')

import chai = require('chai')
const assert = chai.assert

describe('Reader', function () {
  describe('constructor', function () {
    it('should create a Reader', function () {
      const buffer = new Buffer(0)
      const reader = new Reader(buffer)

      assert.instanceOf(reader, Reader)
      assert.equal(reader.buffer, buffer)
    })
  })

  describe('from', function () {
    it('should create a Reader', function () {
      const buffer = new Buffer(0)
      const reader = Reader.from(buffer)

      assert.instanceOf(reader, Reader)
      assert.equal(reader.buffer, buffer)
    })

    it('when cloning a Reader, should slice the buffer from the current position', function () {
      const reader = Reader.from(new Buffer('0102030405', 'hex'))
      reader.skip(2)
      const reader2 = Reader.from(reader)

      assert.instanceOf(reader2, Reader)
      assert.notEqual(reader2, reader)
      assert.notEqual(reader2.buffer, reader.buffer)
      assert.equal(reader2.buffer.length, 3)
      assert.equal(reader2.buffer.toString('hex'), '030405')
    })

    it('should throw if the wrong type of source is provided', function () {
      assert.throws(
        () => Reader.from('test' as any),
        'Reader must be given a Buffer'
      )
    })
  })

  describe('bookmark/restore', function () {
    it('should mark the current position and resume from it', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      reader.readUInt8()
      reader.bookmark()
      reader.skip(3)
      const v1 = reader.readUInt8()
      reader.restore()
      const v2 = reader.readUInt8()

      assert.equal(v1, 5)
      assert.equal(v2, 2)
    })

    it('should throw when resuming too many times', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      reader.readUInt8()
      reader.bookmark()
      reader.skip(3)
      reader.restore()

      assert.throws(
        () => reader.restore(),
        'Cannot restore bookmark when no bookmark set'
      )
    })
  })

  describe('ensureAvailable', function () {
    it('should succeed when enough bytes are available', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      reader.ensureAvailable(6)
    })

    it('should throw when not enough bytes are available', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      assert.throws(
        () => reader.ensureAvailable(7),
        'Tried to read 7 bytes, but only 6 bytes available'
      )
    })

    it('should succeed when enough bytes are available after reading some', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      reader.skip(3)

      reader.ensureAvailable(3)
    })

    it('should throw when not enough bytes are available', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      reader.skip(3)

      assert.throws(
        () => reader.ensureAvailable(4),
        'Tried to read 4 bytes, but only 3 bytes available'
      )
    })
  })

  describe('readUInt', function () {
    it('should read a one byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.readUInt(1)
      const v2 = reader.readUInt(1)

      assert.equal(v1, 1)
      assert.equal(v2, 2)
    })

    it('should read a two byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.readUInt(2)
      const v2 = reader.readUInt(2)

      assert.equal(v1, 258)
      assert.equal(v2, 772)
    })

    it('should read a three byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.readUInt(3)
      const v2 = reader.readUInt(3)

      assert.equal(v1, 66051)
      assert.equal(v2, 263430)
    })

    it('should read a four byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.readUInt(4)

      assert.equal(v, 16909060)
    })

    it('should read a five byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.readUInt(5)

      assert.equal(v, 4328719365)
    })

    it('should read a six byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.readUInt(6)

      assert.equal(v, 1108152157446)
    })

    it('when trying to read a seven byte integer, should throw', function () {
      const reader = Reader.from(new Buffer('01020304050607', 'hex'))

      assert.throws(
        () => reader.readUInt(7),
        'Tried to read too large integer (requested: 7, max: 6)'
      )
    })
  })

  describe('peekUInt', function () {
    it('should read a one byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.peekUInt(1)
      const v2 = reader.peekUInt(1)

      assert.equal(v1, 1)
      assert.equal(v2, 1)
    })

    it('should read a two byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.peekUInt(2)
      const v2 = reader.peekUInt(2)

      assert.equal(v1, 258)
      assert.equal(v2, 258)
    })

    it('should read a three byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.peekUInt(3)
      const v2 = reader.peekUInt(3)

      assert.equal(v1, 66051)
      assert.equal(v2, 66051)
    })

    it('should read a four byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.peekUInt(4)
      const v2 = reader.peekUInt(4)

      assert.equal(v1, 16909060)
      assert.equal(v2, 16909060)
    })

    it('should read a five byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.peekUInt(5)
      const v2 = reader.peekUInt(5)

      assert.equal(v1, 4328719365)
      assert.equal(v2, 4328719365)
    })

    it('should read a six byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.peekUInt(6)
      const v2 = reader.peekUInt(6)

      assert.equal(v1, 1108152157446)
      assert.equal(v2, 1108152157446)
    })

    it('when trying to read a seven byte integer, should throw', function () {
      const reader = Reader.from(new Buffer('01020304050607', 'hex'))

      assert.throws(
        () => reader.peekUInt(7),
        'Tried to read too large integer (requested: 7, max: 6)'
      )
    })

    it('when trying to read a negative length integer, should throw', function () {
      const reader = Reader.from(new Buffer('01020304050607', 'hex'))

      assert.throws(
        () => reader.peekUInt(-1),
        'Tried to read integer with negative length (provided: -1)'
      )
    })
  })

  describe('skipUInt', function () {
    it('should skip the given number of bytes', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      reader.skipUInt(5)

      const v = reader.readUInt8()

      assert.equal(v, 6)
    })
  })

  describe('readInt', function () {
    it('should read a one byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.readInt(1)
      const v2 = reader.readInt(1)

      assert.equal(v1, 1)
      assert.equal(v2, 2)
    })

    it('should read a two byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.readInt(2)
      const v2 = reader.readInt(2)

      assert.equal(v1, 258)
      assert.equal(v2, 772)
    })

    it('should read a three byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.readInt(3)
      const v2 = reader.readInt(3)

      assert.equal(v1, 66051)
      assert.equal(v2, 263430)
    })

    it('should read a four byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.readInt(4)

      assert.equal(v, 16909060)
    })

    it('should read a five byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.readInt(5)

      assert.equal(v, 4328719365)
    })

    it('should read a six byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.readInt(6)

      assert.equal(v, 1108152157446)
    })

    it('when trying to read a seven byte integer, should throw', function () {
      const reader = Reader.from(new Buffer('01020304050607', 'hex'))

      assert.throws(
        () => reader.readInt(7),
        'Tried to read too large integer (requested: 7, max: 6)'
      )
    })
  })

  describe('peekInt', function () {
    it('should read a zero byte integer', function () {
      const reader = Reader.from(new Buffer(0))

      const v = reader.peekInt(0)

      assert.equal(v, 0)
    })

    it('should read a one byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.peekInt(1)
      const v2 = reader.peekInt(1)

      assert.equal(v1, 1)
      assert.equal(v2, 1)
    })

    it('should read a two byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.peekInt(2)
      const v2 = reader.peekInt(2)

      assert.equal(v1, 258)
      assert.equal(v2, 258)
    })

    it('should read a three byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.peekInt(3)
      const v2 = reader.peekInt(3)

      assert.equal(v1, 66051)
      assert.equal(v2, 66051)
    })

    it('should read a four byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.peekInt(4)
      const v2 = reader.peekInt(4)

      assert.equal(v1, 16909060)
      assert.equal(v2, 16909060)
    })

    it('should read a five byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.peekInt(5)
      const v2 = reader.peekInt(5)

      assert.equal(v1, 4328719365)
      assert.equal(v2, 4328719365)
    })

    it('should read a six byte integer', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v1 = reader.peekInt(6)
      const v2 = reader.peekInt(6)

      assert.equal(v1, 1108152157446)
      assert.equal(v2, 1108152157446)
    })

    it('when trying to read a seven byte integer, should throw', function () {
      const reader = Reader.from(new Buffer('01020304050607', 'hex'))

      assert.throws(
        () => reader.peekInt(7),
        'Tried to read too large integer (requested: 7, max: 6)'
      )
    })

    it('when trying to read a negative length integer, should throw', function () {
      const reader = Reader.from(new Buffer('01020304050607', 'hex'))

      assert.throws(
        () => reader.peekInt(-1),
        'Tried to read integer with negative length (provided: -1)'
      )
    })
  })

  describe('skipInt', function () {
    it('should skip the given number of bytes', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      reader.skipInt(5)

      const v = reader.readInt8()

      assert.equal(v, 6)
    })
  })

  describe('readVarUInt', function () {
    it('when reading a zero byte variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('00', 'hex'))

      assert.throws(
        () => reader.readVarUInt(),
        'UInt of length 0 is invalid'
      )
    })

    it('should read a one byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('0109', 'hex'))

      const v = reader.readVarUInt()

      assert.equal(v, 9)
      assert.equal(reader.cursor, 2)
    })

    it('should read a two byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('020102', 'hex'))

      const v = reader.readVarUInt()

      assert.equal(v, 258)
      assert.equal(reader.cursor, 3)
    })

    it('should read a three byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('03010203', 'hex'))

      const v = reader.readVarUInt()

      assert.equal(v, 66051)
      assert.equal(reader.cursor, 4)
    })

    it('should read a four byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('0401020304', 'hex'))

      const v = reader.readVarUInt()

      assert.equal(v, 16909060)
      assert.equal(reader.cursor, 5)
    })

    it('should read a five byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('050102030405', 'hex'))

      const v = reader.readVarUInt()

      assert.equal(v, 4328719365)
      assert.equal(reader.cursor, 6)
    })

    it('should read a six byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('06020304050607', 'hex'))

      const v = reader.readVarUInt()

      assert.equal(v, 2211975595527)
      assert.equal(reader.cursor, 7)
    })

    it('when reading a seven byte variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('0701020304050607', 'hex'))

      assert.throws(
        () => reader.readVarUInt(),
        'UInt of length 7 too large to parse as integer'
      )
    })

    it('when reading a truncated variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('04010203', 'hex'))

      assert.throws(
        () => reader.readVarUInt(),
        'Tried to read 4 bytes'
      )
    })

    it('when reading a length-only variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('04', 'hex'))

      assert.throws(
        () => reader.readVarUInt(),
        'Tried to read 4 bytes'
      )
    })
  })

  describe('peekVarUInt', function () {
    it('when reading a zero byte variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('00', 'hex'))

      assert.throws(
        () => reader.peekVarUInt(),
        'UInt of length 0 is invalid'
      )
    })

    it('should read a one byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('0109', 'hex'))

      const v = reader.peekVarUInt()

      assert.equal(v, 9)
      assert.equal(reader.cursor, 0)
    })

    it('should read a two byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('020102', 'hex'))

      const v = reader.peekVarUInt()

      assert.equal(v, 258)
      assert.equal(reader.cursor, 0)
    })

    it('should read a three byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('03010203', 'hex'))

      const v = reader.peekVarUInt()

      assert.equal(v, 66051)
      assert.equal(reader.cursor, 0)
    })

    it('should read a four byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('0401020304', 'hex'))

      const v = reader.peekVarUInt()

      assert.equal(v, 16909060)
      assert.equal(reader.cursor, 0)
    })

    it('should read a five byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('050102030405', 'hex'))

      const v = reader.peekVarUInt()

      assert.equal(v, 4328719365)
      assert.equal(reader.cursor, 0)
    })

    it('should read a six byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('06020304050607', 'hex'))

      const v = reader.peekVarUInt()

      assert.equal(v, 2211975595527)
      assert.equal(reader.cursor, 0)
    })

    it('when reading a seven byte variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('0701020304050607', 'hex'))

      assert.throws(
        () => reader.peekVarUInt(),
        'UInt of length 7 too large to parse as integer'
      )
    })
  })

  describe('skipVarUInt', function () {
    it.skip('when skipping a zero byte variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('00', 'hex'))

      assert.throws(
        () => reader.skipVarUInt(),
        'UInt of length 0 is invalid'
      )
    })

    it('should skip a one byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('0101', 'hex'))

      reader.skipVarUInt()

      assert.equal(reader.cursor, 2)
    })

    it('should skip a two byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('020102', 'hex'))

      reader.skipVarUInt()

      assert.equal(reader.cursor, 3)
    })

    it('should skip a three byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('03010203', 'hex'))

      reader.skipVarUInt()

      assert.equal(reader.cursor, 4)
    })

    it('should skip a four byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('0401020304', 'hex'))

      reader.skipVarUInt()

      assert.equal(reader.cursor, 5)
    })

    it('should skip a five byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('050102030405', 'hex'))

      reader.skipVarUInt()

      assert.equal(reader.cursor, 6)
    })

    it('should skip a six byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('06010203040506', 'hex'))

      reader.skipVarUInt()

      assert.equal(reader.cursor, 7)
    })

    it.skip('when skipping a seven byte variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('0701020304050607', 'hex'))

      assert.throws(
        () => reader.skipVarUInt(),
        'UInt of length 7 too large to parse as integer'
      )
    })
  })

  describe('readVarInt', function () {
    it('when reading a zero byte variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('00', 'hex'))

      assert.throws(
        () => reader.readVarInt(),
        'Int of length 0 is invalid'
      )
    })

    it('should read a one byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('0109', 'hex'))

      const v = reader.readVarInt()

      assert.equal(v, 9)
      assert.equal(reader.cursor, 2)
    })

    it('should read a two byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('020102', 'hex'))

      const v = reader.readVarInt()

      assert.equal(v, 258)
      assert.equal(reader.cursor, 3)
    })

    it('should read a three byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('03010203', 'hex'))

      const v = reader.readVarInt()

      assert.equal(v, 66051)
      assert.equal(reader.cursor, 4)
    })

    it('should read a four byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('0401020304', 'hex'))

      const v = reader.readVarInt()

      assert.equal(v, 16909060)
      assert.equal(reader.cursor, 5)
    })

    it('should read a five byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('050102030405', 'hex'))

      const v = reader.readVarInt()

      assert.equal(v, 4328719365)
      assert.equal(reader.cursor, 6)
    })

    it('should read a six byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('06020304050607', 'hex'))

      const v = reader.readVarInt()

      assert.equal(v, 2211975595527)
      assert.equal(reader.cursor, 7)
    })

    it('when reading a seven byte variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('0701020304050607', 'hex'))

      assert.throws(
        () => reader.readVarInt(),
        'Int of length 7 too large to parse as integer'
      )
    })

    it('when reading a truncated variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('04010203', 'hex'))

      assert.throws(
        () => reader.readVarInt(),
        'Tried to read 4 bytes'
      )
    })

    it('when reading a length-only variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('04', 'hex'))

      assert.throws(
        () => reader.readVarInt(),
        'Tried to read 4 bytes'
      )
    })
  })

  describe('peekVarInt', function () {
    it('when reading a zero byte variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('00', 'hex'))

      assert.throws(
        () => reader.peekVarInt(),
        'Int of length 0 is invalid'
      )
    })

    it('should read a one byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('0109', 'hex'))

      const v = reader.peekVarInt()

      assert.equal(v, 9)
      assert.equal(reader.cursor, 0)
    })

    it('should read a two byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('020102', 'hex'))

      const v = reader.peekVarInt()

      assert.equal(v, 258)
      assert.equal(reader.cursor, 0)
    })

    it('should read a three byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('03010203', 'hex'))

      const v = reader.peekVarInt()

      assert.equal(v, 66051)
      assert.equal(reader.cursor, 0)
    })

    it('should read a four byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('0401020304', 'hex'))

      const v = reader.peekVarInt()

      assert.equal(v, 16909060)
      assert.equal(reader.cursor, 0)
    })

    it('should read a five byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('050102030405', 'hex'))

      const v = reader.peekVarInt()

      assert.equal(v, 4328719365)
      assert.equal(reader.cursor, 0)
    })

    it('should read a six byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('06020304050607', 'hex'))

      const v = reader.peekVarInt()

      assert.equal(v, 2211975595527)
      assert.equal(reader.cursor, 0)
    })

    it('when reading a seven byte variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('0701020304050607', 'hex'))

      assert.throws(
        () => reader.peekVarInt(),
        'Int of length 7 too large to parse as integer'
      )
    })
  })

  describe('skipVarInt', function () {
    it.skip('when skipping a zero byte variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('00', 'hex'))

      assert.throws(
        () => reader.skipVarInt(),
        'Int of length 0 is invalid'
      )
    })

    it('should skip a one byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('0101', 'hex'))

      reader.skipVarInt()

      assert.equal(reader.cursor, 2)
    })

    it('should skip a two byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('020102', 'hex'))

      reader.skipVarInt()

      assert.equal(reader.cursor, 3)
    })

    it('should skip a three byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('03010203', 'hex'))

      reader.skipVarInt()

      assert.equal(reader.cursor, 4)
    })

    it('should skip a four byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('0401020304', 'hex'))

      reader.skipVarInt()

      assert.equal(reader.cursor, 5)
    })

    it('should skip a five byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('050102030405', 'hex'))

      reader.skipVarInt()

      assert.equal(reader.cursor, 6)
    })

    it('should skip a six byte variable-length integer', function () {
      const reader = Reader.from(new Buffer('06010203040506', 'hex'))

      reader.skipVarInt()

      assert.equal(reader.cursor, 7)
    })

    it.skip('when skipping a seven byte variable-length integer, should throw', function () {
      const reader = Reader.from(new Buffer('0701020304050607', 'hex'))

      assert.throws(
        () => reader.skipVarInt(),
        'Int of length 7 too large to parse as integer'
      )
    })
  })

  describe('readOctetString', function () {
    it('should read a zero length octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.readOctetString(0)

      assert.equal(v.toString('hex'), '')
      assert.equal(reader.cursor, 0)
    })

    it('should read a one byte long octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.readOctetString(1)

      assert.equal(v.toString('hex'), '01')
      assert.equal(reader.cursor, 1)
    })

    it('should read a two byte long octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.readOctetString(2)

      assert.equal(v.toString('hex'), '0102')
      assert.equal(reader.cursor, 2)
    })

    it('when reading past the end of the buffer, should throw', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      assert.throws(() => reader.readOctetString(7))
    })
  })

  describe('peekOctetString', function () {
    it('should read a zero length octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.peekOctetString(0)

      assert.equal(v.toString('hex'), '')
      assert.equal(reader.cursor, 0)
    })

    it('should read a one byte long octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.peekOctetString(1)

      assert.equal(v.toString('hex'), '01')
      assert.equal(reader.cursor, 0)
    })

    it('should read a two byte long octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.peekOctetString(2)

      assert.equal(v.toString('hex'), '0102')
      assert.equal(reader.cursor, 0)
    })

    it('when reading past the end of the buffer, should throw', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      assert.throws(() => reader.peekOctetString(7))
    })
  })

  describe('skipOctetString', function () {
    it('should read a zero length octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      reader.skipOctetString(0)

      assert.equal(reader.cursor, 0)
    })

    it('should read a one byte long octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      reader.skipOctetString(1)

      assert.equal(reader.cursor, 1)
    })

    it('should read a two byte long octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      reader.skipOctetString(2)

      assert.equal(reader.cursor, 2)
    })

    it('when reading past the end of the buffer, should throw', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      assert.throws(() => reader.skipOctetString(7))
    })
  })

  describe('readLengthPrefix', function () {
    it('should read a zero length prefix', function () {
      const reader = Reader.from(new Buffer('00', 'hex'))

      const v = reader.readLengthPrefix()

      assert.equal(v, 0)
      assert.equal(reader.cursor, 1)
    })

    it('should read a small length prefix', function () {
      const reader = Reader.from(new Buffer('7f', 'hex'))

      const v = reader.readLengthPrefix()

      assert.equal(v, 127)
      assert.equal(reader.cursor, 1)
    })

    it('should read a large length prefix', function () {
      const reader = Reader.from(new Buffer('86010203040506', 'hex'))

      const v = reader.readLengthPrefix()

      assert.equal(v, 1108152157446)
      assert.equal(reader.cursor, 7)
    })

    it('should throw when length is greater than six bytes', function () {
      const reader = Reader.from(new Buffer('8701020304050607', 'hex'))

      assert.throws(
        () => reader.readLengthPrefix(),
        'Tried to read too large integer (requested: 7, max: 6)'
      )
    })

    it('should throw when length prefix is 0x80 (non-canonical)', function () {
      const reader = Reader.from(new Buffer('80', 'hex'))

      assert.throws(
        () => reader.readLengthPrefix(),
        'Length prefix encoding is not canonical: 0 encoded in 0 bytes'
      )
    })

    it('should throw when length prefix is 0x8100 (non-canonical)', function () {
      const reader = Reader.from(new Buffer('8100', 'hex'))

      assert.throws(
        () => reader.readLengthPrefix(),
        'Length prefix encoding is not canonical: 0 encoded in 1 bytes'
      )
    })

    it('should throw when length prefix is 0x8101 (non-canonical)', function () {
      const reader = Reader.from(new Buffer('810100', 'hex'))

      assert.throws(
        () => reader.readLengthPrefix(),
        'Length prefix encoding is not canonical: 1 encoded in 1 bytes'
      )
    })

    it('should throw when length prefix is 0x820001 (non-canonical)', function () {
      const reader = Reader.from(new Buffer('82000100', 'hex'))

      assert.throws(
        () => reader.readLengthPrefix(),
        'Length prefix encoding is not canonical: 1 encoded in 2 bytes'
      )
    })
  })

  describe('readVarOctetString', function () {
    it('should read a zero length octet string', function () {
      const reader = Reader.from(new Buffer('00010203040506', 'hex'))

      const v = reader.readVarOctetString()

      assert.equal(v.toString('hex'), '')
      assert.equal(reader.cursor, 1)
    })

    it('should read a one byte long octet string', function () {
      const reader = Reader.from(new Buffer('01010203040506', 'hex'))

      const v = reader.readVarOctetString()

      assert.equal(v.toString('hex'), '01')
      assert.equal(reader.cursor, 2)
    })

    it('should read a two byte long octet string', function () {
      const reader = Reader.from(new Buffer('02010203040506', 'hex'))

      const v = reader.readVarOctetString()

      assert.equal(v.toString('hex'), '0102')
      assert.equal(reader.cursor, 3)
    })

    it('when reading past the end of the buffer, should throw', function () {
      const reader = Reader.from(new Buffer('07010203040506', 'hex'))

      assert.throws(
        () => reader.readVarOctetString(),
        'Tried to read 7 bytes, but only 6 bytes available'
      )
    })
  })

  describe('peekVarOctetString', function () {
    it('should read a zero length octet string', function () {
      const reader = Reader.from(new Buffer('00010203040506', 'hex'))

      const v = reader.peekVarOctetString()

      assert.equal(v.toString('hex'), '')
      assert.equal(reader.cursor, 0)
    })

    it('should read a one byte long octet string', function () {
      const reader = Reader.from(new Buffer('01010203040506', 'hex'))

      const v = reader.peekVarOctetString()

      assert.equal(v.toString('hex'), '01')
      assert.equal(reader.cursor, 0)
    })

    it('should read a two byte long octet string', function () {
      const reader = Reader.from(new Buffer('02010203040506', 'hex'))

      const v = reader.peekVarOctetString()

      assert.equal(v.toString('hex'), '0102')
      assert.equal(reader.cursor, 0)
    })

    it('when reading past the end of the buffer, should throw', function () {
      const reader = Reader.from(new Buffer('07010203040506', 'hex'))

      assert.throws(
        () => reader.peekVarOctetString(),
        'Tried to read 7 bytes, but only 6 bytes available'
      )
    })
  })

  describe('skipVarOctetString', function () {
    it('should skip a zero length octet string', function () {
      const reader = Reader.from(new Buffer('00010203040506', 'hex'))

      reader.skipVarOctetString()

      assert.equal(reader.cursor, 1)
    })

    it('should skip a one byte long octet string', function () {
      const reader = Reader.from(new Buffer('01010203040506', 'hex'))

      reader.skipVarOctetString()

      assert.equal(reader.cursor, 2)
    })

    it('should skip a two byte long octet string', function () {
      const reader = Reader.from(new Buffer('02010203040506', 'hex'))

      reader.skipVarOctetString()

      assert.equal(reader.cursor, 3)
    })

    it('when skiping past the end of the buffer, should throw', function () {
      const reader = Reader.from(new Buffer('07010203040506', 'hex'))

      assert.throws(
        () => reader.skipVarOctetString(),
        'Tried to read 7 bytes, but only 6 bytes available'
      )
    })
  })

  describe('read', function () {
    it('should read a zero length octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.read(0)

      assert.equal(v.toString('hex'), '')
      assert.equal(reader.cursor, 0)
    })

    it('should read a one byte long octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.read(1)

      assert.equal(v.toString('hex'), '01')
      assert.equal(reader.cursor, 1)
    })

    it('should read a two byte long octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.read(2)

      assert.equal(v.toString('hex'), '0102')
      assert.equal(reader.cursor, 2)
    })

    it('when reading past the end of the buffer, should throw', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      assert.throws(() => reader.read(7))
    })
  })

  describe('peek', function () {
    it('should read a zero length octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.peek(0)

      assert.equal(v.toString('hex'), '')
      assert.equal(reader.cursor, 0)
    })

    it('should read a one byte long octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.peek(1)

      assert.equal(v.toString('hex'), '01')
      assert.equal(reader.cursor, 0)
    })

    it('should read a two byte long octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      const v = reader.peek(2)

      assert.equal(v.toString('hex'), '0102')
      assert.equal(reader.cursor, 0)
    })

    it('when reading past the end of the buffer, should throw', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      assert.throws(() => reader.peek(7))
    })
  })

  describe('skip', function () {
    it('should read a zero length octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      reader.skip(0)

      assert.equal(reader.cursor, 0)
    })

    it('should read a one byte long octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      reader.skip(1)

      assert.equal(reader.cursor, 1)
    })

    it('should read a two byte long octet string', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      reader.skip(2)

      assert.equal(reader.cursor, 2)
    })

    it('when reading past the end of the buffer, should throw', function () {
      const reader = Reader.from(new Buffer('010203040506', 'hex'))

      assert.throws(() => reader.skip(7))
    })
  })

  describe('readUInt8', function () {
    it('should read an 8-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ff', 'hex'))

      const v = reader.readUInt8()

      assert.equal(v, 255)
      assert.equal(reader.cursor, 1)
    })
  })

  describe('readUInt16', function () {
    it('should read an 16-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ffff', 'hex'))

      const v = reader.readUInt16()

      assert.equal(v, 65535)
      assert.equal(reader.cursor, 2)
    })
  })

  describe('readUInt32', function () {
    it('should read an 32-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ffffffff', 'hex'))

      const v = reader.readUInt32()

      assert.equal(v, 4294967295)
      assert.equal(reader.cursor, 4)
    })
  })

  describe('readUInt64', function () {
    it('should read an 64-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('01010101ffffffff', 'hex'))

      const v = reader.readUInt64()

      assert.deepEqual(v, [16843009, 4294967295])
      assert.equal(reader.cursor, 8)
    })
  })

  describe('peekUInt8', function () {
    it('should read an 8-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ff', 'hex'))

      const v = reader.peekUInt8()

      assert.equal(v, 255)
      assert.equal(reader.cursor, 0)
    })
  })

  describe('peekUInt16', function () {
    it('should read an 16-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ffff', 'hex'))

      const v = reader.peekUInt16()

      assert.equal(v, 65535)
      assert.equal(reader.cursor, 0)
    })
  })

  describe('peekUInt32', function () {
    it('should read an 32-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ffffffff', 'hex'))

      const v = reader.peekUInt32()

      assert.equal(v, 4294967295)
      assert.equal(reader.cursor, 0)
    })
  })

  describe('peekUInt64', function () {
    it('should read an 64-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('01010101ffffffff', 'hex'))

      const v = reader.peekUInt64()

      assert.deepEqual(v, [16843009, 4294967295])
      assert.equal(reader.cursor, 0)
    })
  })

  describe('skipUInt8', function () {
    it('should read an 8-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ff', 'hex'))

      reader.skipUInt8()

      assert.equal(reader.cursor, 1)
    })
  })

  describe('skipUInt16', function () {
    it('should read an 16-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ffff', 'hex'))

      reader.skipUInt16()

      assert.equal(reader.cursor, 2)
    })
  })

  describe('skipUInt32', function () {
    it('should read an 32-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ffffffff', 'hex'))

      reader.skipUInt32()

      assert.equal(reader.cursor, 4)
    })
  })

  describe('skipUInt64', function () {
    it('should read an 64-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('01010101ffffffff', 'hex'))

      reader.skipUInt64()

      assert.equal(reader.cursor, 8)
    })
  })

  describe('readInt8', function () {
    it('should read an 8-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ff', 'hex'))

      const v = reader.readInt8()

      assert.equal(v, -1)
      assert.equal(reader.cursor, 1)
    })
  })

  describe('readInt16', function () {
    it('should read an 16-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ffff', 'hex'))

      const v = reader.readInt16()

      assert.equal(v, -1)
      assert.equal(reader.cursor, 2)
    })
  })

  describe('readInt32', function () {
    it('should read an 32-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ffffffff', 'hex'))

      const v = reader.readInt32()

      assert.equal(v, -1)
      assert.equal(reader.cursor, 4)
    })
  })

  describe.skip('readInt64', function () {
    it('should read an 64-bit unsigned integer', function () {
      // const reader = Reader.from(new Buffer('01010101ffffffff', 'hex'))
      //
      // const v = reader.readInt64()
      //
      // assert.deepEqual(v, [16843009, 4294967295])
      // assert.equal(reader.cursor, 8)
    })
  })

  describe('peekInt8', function () {
    it('should read an 8-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ff', 'hex'))

      const v = reader.peekInt8()

      assert.equal(v, -1)
      assert.equal(reader.cursor, 0)
    })
  })

  describe('peekInt16', function () {
    it('should read an 16-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ffff', 'hex'))

      const v = reader.peekInt16()

      assert.equal(v, -1)
      assert.equal(reader.cursor, 0)
    })
  })

  describe('peekInt32', function () {
    it('should read an 32-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ffffffff', 'hex'))

      const v = reader.peekInt32()

      assert.equal(v, -1)
      assert.equal(reader.cursor, 0)
    })
  })

  describe.skip('peekInt64', function () {
    it('should read an 64-bit unsigned integer', function () {
      // const reader = Reader.from(new Buffer('01010101ffffffff', 'hex'))
      //
      // const v = reader.peekInt64()
      //
      // assert.deepEqual(v, [16843009, 4294967295])
      // assert.equal(reader.cursor, 0)
    })
  })

  describe('skipInt8', function () {
    it('should read an 8-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ff', 'hex'))

      reader.skipInt8()

      assert.equal(reader.cursor, 1)
    })
  })

  describe('skipInt16', function () {
    it('should read an 16-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ffff', 'hex'))

      reader.skipInt16()

      assert.equal(reader.cursor, 2)
    })
  })

  describe('skipInt32', function () {
    it('should read an 32-bit unsigned integer', function () {
      const reader = Reader.from(new Buffer('ffffffff', 'hex'))

      reader.skipInt32()

      assert.equal(reader.cursor, 4)
    })
  })

  describe.skip('skipInt64', function () {
    it('should read an 64-bit unsigned integer', function () {
      // const reader = Reader.from(new Buffer('01010101ffffffff', 'hex'))
      //
      // reader.skipInt64()
      //
      // assert.equal(reader.cursor, 8)
    })
  })
})
