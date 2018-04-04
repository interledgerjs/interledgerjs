import 'mocha'
import { assert } from 'chai'
import { Packet, StreamMoneyFrame, BaseFrame } from '../src/protocol'
import { Reader, Writer } from 'oer-utils'
require('source-map-support').install()

describe('Packet Format', function () {
  describe('decryptAndDeserialize()', function () {
    it('should throw an error if it cannot decrypt the packet', function () {
      const packet = Buffer.from('9c4f511dbc865607311609d7559e01e1fd22f985292539e1f5d8f3eb0832060f', 'hex')

      assert.throws(() => Packet.decryptAndDeserialize(Buffer.alloc(32), packet), 'Unable to decrypt packet. Data was corrupted or packet was encrypted with the wrong key')
    })

    it('should throw an error if the version is unsupported', function () {
      const decryptedPacket = Buffer.from('9c4f511dbc865607311609d7559e01e1fd22f985292539e1f5d8f3eb0832060f', 'hex')

      assert.throws(() => Packet._deserializeUnencrypted(decryptedPacket), 'Unsupported protocol version: 156')
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
  })
})
