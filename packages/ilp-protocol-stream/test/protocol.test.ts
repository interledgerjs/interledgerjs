import 'mocha'
import { assert } from 'chai'
import { Packet, StreamMoneyFrame, Frame } from '../src/protocol'
import { Reader, Writer } from 'oer-utils'

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
      class UnknownFrame extends Frame {
        constructor () {
          super(255, 'UnknownFrame')
        }

        static fromBuffer (reader: Reader): UnknownFrame {
          return new UnknownFrame()
        }

        writeTo (writer: Writer): Writer {
          writer.writeUInt8(this.type)
          writer.writeVarOctetString(Buffer.alloc(47, '0F', 'hex'))
          return writer
        }
      }
      const packet = new Packet(0, 14, [
        new StreamMoneyFrame(1, 1),
        new StreamMoneyFrame(2, 2),
        new UnknownFrame(),
        new StreamMoneyFrame(3, 3),
        new UnknownFrame()
      ])

      const serialized = packet._serialize()
      const deserializedPacket = Packet._deserializeUnencrypted(serialized)

      assert.equal(deserializedPacket.frames.length, 3)
    })
  })
})
