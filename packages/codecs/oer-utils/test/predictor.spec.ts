import Predictor = require('../src/lib/predictor')

import chai = require('chai')
const assert = chai.assert

describe('Predictor', function () {
  describe('constructor', function () {
    it('should create a Predictor', function () {
      const predictor = new Predictor()

      assert.instanceOf(predictor, Predictor)
    })
  })

  describe('writeUInt', function () {
    it('should increment by the length of the unsigned integer', function () {
      const predictor = new Predictor()

      predictor.writeUInt(0, 1)

      assert.equal(predictor.getSize(), 1)
    })

    it('should increment multiple times for multiple integers', function () {
      const predictor = new Predictor()

      predictor.writeUInt(0, 1)
      predictor.writeUInt(0, 4)

      assert.equal(predictor.getSize(), 5)
    })
  })

  describe('writeVarUInt', function () {
    it('should accept a buffer and add the correct size', function () {
      const predictor = new Predictor()

      predictor.writeVarUInt(new Buffer(10))

      assert.equal(predictor.getSize(), 11)
    })

    it('should accept zero and add 2 bytes to the size', function () {
      const predictor = new Predictor()

      predictor.writeVarUInt(0)

      assert.equal(predictor.getSize(), 2)
    })

    it('should accept 0x01020304 and add 5 bytes to the size', function () {
      const predictor = new Predictor()

      predictor.writeVarUInt(0x01020304)

      assert.equal(predictor.getSize(), 5)
    })

    it('should accept MAX_SAFE_INTEGER and add 8 bytes to the size', function () {
      const predictor = new Predictor()

      predictor.writeVarUInt(Number.MAX_SAFE_INTEGER)

      assert.equal(predictor.getSize(), 8)
    })

    it('when writing a non-integer, should throw', function () {
      const predictor = new Predictor()

      assert.throws(
        () => predictor.writeVarUInt(0.5),
        'UInt must be an integer'
      )
    })

    it('when writing a negative integer, should throw', function () {
      const predictor = new Predictor()

      assert.throws(
        () => predictor.writeVarUInt(-1),
        'UInt must be positive'
      )
    })
  })

  describe('writeOctetString', function () {
    it('should increment by the given length of the octet string', function () {
      const predictor = new Predictor()

      predictor.writeOctetString(new Buffer(10), 5)

      assert.equal(predictor.getSize(), 5)
    })
  })

  describe('writeVarOctetString', function () {
    it('should calculate the correct length for an empty buffer', function () {
      const predictor = new Predictor()

      predictor.writeVarOctetString(new Buffer(0))

      assert.equal(predictor.getSize(), 1)
    })

    it('should calculate the correct length for a short buffer', function () {
      const predictor = new Predictor()

      predictor.writeVarOctetString(new Buffer(10))

      assert.equal(predictor.getSize(), 11)
    })

    it('should calculate the correct length for a long buffer', function () {
      const predictor = new Predictor()

      predictor.writeVarOctetString(new Buffer(256))

      assert.equal(predictor.getSize(), 259)
    })
  })

  describe('write', function () {
    it('should add the size of the buffer to the total size', function () {
      const predictor = new Predictor()

      predictor.write(new Buffer(15))

      assert.equal(predictor.getSize(), 15)
    })
  })

  describe('skip', function () {
    it('should add the given number of bytes to the total size', function () {
      const predictor = new Predictor()

      predictor.skip(15)

      assert.equal(predictor.getSize(), 15)
    })
  })

  describe('writeUInt8', function () {
    it('should add 1 byte to the size', function () {
      const predictor = new Predictor()

      predictor.writeUInt8(15)

      assert.equal(predictor.getSize(), 1)
    })
  })

  describe('writeUInt16', function () {
    it('should add 1 byte to the size', function () {
      const predictor = new Predictor()

      predictor.writeUInt16(15)

      assert.equal(predictor.getSize(), 2)
    })
  })

  describe('writeUInt32', function () {
    it('should add 1 byte to the size', function () {
      const predictor = new Predictor()

      predictor.writeUInt32(15)

      assert.equal(predictor.getSize(), 4)
    })
  })

  describe('writeUInt64', function () {
    it('should add 1 byte to the size', function () {
      const predictor = new Predictor()

      predictor.writeUInt64(15)

      assert.equal(predictor.getSize(), 8)
    })
  })
})
