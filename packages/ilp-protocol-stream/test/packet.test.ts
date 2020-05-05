import * as assert from 'assert'
import 'mocha'
import * as PacketModule from '../src/packet'
import {
  Packet,
  StreamMoneyFrame,
  Frame,
  FrameType,
  StreamMaxMoneyFrame,
  StreamMoneyBlockedFrame
} from '../src/packet'
import { Reader, Writer } from 'oer-utils'
import * as Long from 'long'

describe('Packet Format', function () {
  describe('decryptAndDeserialize()', function () {
    it('should throw an error if it cannot decrypt the packet', async function () {
      const packet = Buffer.from('9c4f511dbc865607311609d7559e01e1fd22f985292539e1f5d8f3eb0832060f', 'hex')

      try {
        await Packet.decryptAndDeserialize(Buffer.alloc(32), packet)
      } catch (err) {
        assert.equal(err.message, 'Unable to decrypt packet. Data was corrupted or packet was encrypted with the wrong key')
        return
      }
      assert(false)
    })

    it('should throw an error if the version is unsupported', function () {
      const decryptedPacket = Buffer.from('9c4f511dbc865607311609d7559e01e1fd22f985292539e1f5d8f3eb0832060f', 'hex')

      assert.throws(() => {
        return Packet._deserializeUnencrypted(decryptedPacket)
      }, new Error('Unsupported protocol version: 156'))
    })

    it('should skip unknown frames', function () {
      const unknownFrameWriter = new Writer()
      unknownFrameWriter.writeUInt8(255)
      unknownFrameWriter.writeVarOctetString(Buffer.alloc(47, '0F', 'hex'))
      const unknownFrame = unknownFrameWriter.getBuffer()

      const lastFrame = new StreamMoneyFrame(3, 3).writeTo(new Writer()).getBuffer()

      const packet = new Packet(0, 14, 5, [
        new StreamMoneyFrame(1, 1),
        new StreamMoneyFrame(2, 2)
      ])

      const serialized = packet._serialize()
      serialized[7] = 5
      const serializedWithExtraFrames = Buffer.concat([
        serialized,
        unknownFrame,
        lastFrame,
        unknownFrame
      ])
      const deserializedPacket = Packet._deserializeUnencrypted(serializedWithExtraFrames)

      assert.equal(deserializedPacket.frames.length, 3)
      assert.equal((deserializedPacket.frames[2] as StreamMoneyFrame).streamId.toNumber(), 3)
    })

    it('should stop reading after the number of frames specified', function () {
      const packet = new Packet(0, 14, 5, [
        new StreamMoneyFrame(1, 1),
        new StreamMoneyFrame(2, 2)
      ])
      const serialized = packet._serialize()
      const lastFrame = new StreamMoneyFrame(3, 3).writeTo(new Writer()).getBuffer()
      const serializedWithExtraFrames = Buffer.concat([
        serialized,
        lastFrame
      ])

      const deserializedPacket = Packet._deserializeUnencrypted(serializedWithExtraFrames)
      assert.equal(deserializedPacket.frames.length, 2)
    })
  })

  describe('StreamMaxMoneyFrame', function () {
    it('converts larger receiveMax to MaxUInt64', function () {
      const writer = new Writer()
      writer.writeVarUInt(123) // streamId
      writer.writeVarOctetString(Buffer.from([ // receiveMax
        0x01, 0x02, 0x03,
        0x04, 0x05, 0x06,
        0x07, 0x08, 0x09
      ]))
      writer.writeVarUInt(123) // totalReceived

      const frame = StreamMaxMoneyFrame.fromContents(new Reader(writer.getBuffer()))
      assert.deepEqual(frame.receiveMax, Long.MAX_UNSIGNED_VALUE)
    })
  })

  describe('StreamMoneyBlockedFrame', function () {
    it('converts larger sendMax to MaxUInt64', function () {
      const writer = new Writer()
      writer.writeVarUInt(123) // streamId
      writer.writeVarOctetString(Buffer.from([ // sendMax
        0x01, 0x02, 0x03,
        0x04, 0x05, 0x06,
        0x07, 0x08, 0x09
      ]))
      writer.writeVarUInt(123) // totalSent

      const frame = StreamMoneyBlockedFrame.fromContents(new Reader(writer.getBuffer()))
      assert.deepEqual(frame.sendMax, Long.MAX_UNSIGNED_VALUE)
    })
  })
})

describe('Packet Fixtures', function () {
  const fixtures = require('./fixtures/packets.json')
  fixtures.forEach(function (fixture: any) {
    const wantBuffer = Buffer.from(fixture.buffer, 'base64')
    const wantPacket = new Packet(
      fixture.packet.sequence,
      fixture.packet.packetType,
      fixture.packet.amount,
      fixture.packet.frames.map(buildFrame)
    )

    it('deserializes ' + fixture.name, function () {
      const gotPacket = Packet._deserializeUnencrypted(wantBuffer)
      assert.deepEqual(gotPacket, wantPacket)
    })

    if (fixture.decode_only) return

    it('serializes ' + fixture.name, function () {
      const gotBuffer = wantPacket._serialize()
      assert(gotBuffer.equals(wantBuffer))
    })
  })
})

function buildFrame (options: any) {
  for (const key in options) {
    const value = options[key]
    if (typeof value === 'string') {
      if (/^\d+$/.test(value)) {
        options[key] = Long.fromString(value, true)
      } else if (['data', 'receipt'].indexOf(key) !== -1) {
        options[key] = Buffer.from(value, 'base64')
      }
    }
  }
  return Object.assign(
    Object.create(PacketModule[options.name + 'Frame'].prototype),
    options
  )
}
