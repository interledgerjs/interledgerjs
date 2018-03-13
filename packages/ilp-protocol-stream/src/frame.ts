import { Reader, Writer } from 'oer-utils'
import BigNumber from 'bignumber.js'

export enum FrameType {
  StreamMoney = 1,
}

export abstract class Frame {
  type: number
  name: string

  constructor (type: number, name: string) {
    this.type = type
    this.name = name
  }

  abstract byteLength (): number

  abstract writeTo (writer: Writer): Writer

  static fromBuffer (reader: Reader): Frame {
    throw new Error(`class method "fromBuffer" is not implemented`)
  }
}

export class StreamMoneyFrame extends Frame {
  readonly streamId: BigNumber
  readonly amount: BigNumber
  readonly isEnd: boolean
  protected encoded?: Buffer

  constructor (streamId: BigNumber.Value, amount: BigNumber.Value, isEnd: boolean = false) {
    super(FrameType.StreamMoney, 'StreamMoney')
    this.streamId = new BigNumber(streamId)
    this.amount = new BigNumber(amount)
    this.isEnd = isEnd
  }

  byteLength (): number {
    // TODO do this without actually writing bytes
    if (!this.encoded) {
      const writer = new Writer()
      this.writeTo(writer)
      this.encoded = writer.getBuffer()
    }
    return this.encoded.length
  }

  writeTo (writer: Writer): Writer {
    // TODO should frames be length-prefixed to enable skipping unknown ones?
    writer.writeUInt8(this.type)
    writer.writeVarUInt(this.streamId)
    writer.writeVarUInt(this.amount)
    // TODO should this be a bitmask instead?
    writer.writeUInt8(this.isEnd ? 1 : 0)
    return writer
  }

  static fromBuffer (reader: Reader): StreamMoneyFrame {
    const type = reader.readUInt8BigNum().toNumber()
    if (type !== FrameType.StreamMoney) {
      throw new Error(`Cannot read StreamMoneyFrame from Buffer. Expected type ${FrameType.StreamMoney}, got: ${type}`)
    }

    const streamId = reader.readVarUIntBigNum()
    const amount = reader.readVarUIntBigNum()
    const isEnd = reader.readUInt8BigNum().toNumber() === 1
    return new StreamMoneyFrame(streamId, amount, isEnd)
  }
}

export function isStreamMoneyFrame (frame: Frame): frame is StreamMoneyFrame {
  return frame.type === FrameType.StreamMoney
}

export function parseFrames (buffer: Reader | Buffer): Frame[] {
  const reader = Reader.from(buffer)
  const frames: Frame[] = []

  while (reader.cursor < reader.buffer.length) {
    const type = reader.peekUInt8BigNum().toNumber()

    switch (type) {
      case FrameType.StreamMoney:
        frames.push(StreamMoneyFrame.fromBuffer(reader))
        break
      default:
        throw new Error(`Unknown frame type: ${type}`)
    }
  }
  return frames
}