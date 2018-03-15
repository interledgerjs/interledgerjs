import { Reader, Writer, Predictor } from 'oer-utils'
import BigNumber from 'bignumber.js'

export enum FrameType {
  // TODO reorder frame numbers to something sensible
  StreamMoney = 1,
  SourceAccount = 2,
  AmountArrived = 3,
  MinimumDestinationAmount = 4,
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
  readonly shares: BigNumber
  readonly isEnd: boolean
  protected encoded?: Buffer

  constructor (streamId: BigNumber.Value, amount: BigNumber.Value, isEnd: boolean = false) {
    super(FrameType.StreamMoney, 'StreamMoney')
    this.streamId = new BigNumber(streamId)
    this.shares = new BigNumber(amount)
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
    writer.writeVarUInt(this.shares)
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

export class SourceAccountFrame extends Frame {
  readonly sourceAccount: string

  constructor (sourceAccount: string) {
    super(FrameType.SourceAccount, 'SourceAccountFrame')
    this.sourceAccount = sourceAccount
  }

  byteLength (): number {
    const predictor = new Predictor()
    predictor.writeUInt8(this.type)
    predictor.writeVarOctetString(Buffer.from(this.sourceAccount))
    return predictor.getSize()
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    writer.writeVarOctetString(Buffer.from(this.sourceAccount))
    return writer
  }

  static fromBuffer (reader: Reader): SourceAccountFrame {
    const type = reader.readUInt8BigNum().toNumber()
    if (type !== FrameType.SourceAccount) {
      throw new Error(`Cannot read SourceAccountFrame from Buffer. Expected type ${FrameType.SourceAccount}, got: ${type}`)
    }

    const sourceAccount = reader.readVarOctetString().toString('utf8')
    return new SourceAccountFrame(sourceAccount)
  }
}

export function isSourceAccountFrame (frame: Frame): frame is SourceAccountFrame {
  return frame.type === FrameType.SourceAccount
}

export class AmountArrivedFrame extends Frame {
  readonly amount: BigNumber

  constructor(amount: BigNumber.Value) {
    super(FrameType.AmountArrived, 'AmountArrived')
    this.amount = new BigNumber(amount)
  }

  byteLength (): number {
    const writer = new Writer()
    this.writeTo(writer)
    return writer.getBuffer().length
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    writer.writeVarUInt(this.amount)
    return writer
  }

  static fromBuffer (reader: Reader): AmountArrivedFrame {
    const type = reader.readUInt8BigNum().toNumber()
    if (type !== FrameType.AmountArrived) {
      throw new Error(`Cannot read AmountArrivedFrame from Buffer. Expected type ${FrameType.AmountArrived}, got: ${type}`)
    }

    const amount = reader.readVarUInt()
    return new AmountArrivedFrame(amount)
  }
}

export function isAmountArrivedFrame (frame: Frame): frame is AmountArrivedFrame {
  return frame.type === FrameType.AmountArrived
}

export class MinimumDestinationAmountFrame extends Frame {
  readonly amount: BigNumber

  constructor(amount: BigNumber.Value) {
    super(FrameType.MinimumDestinationAmount, 'MinimumDestinationAmount')
    this.amount = new BigNumber(amount)
  }

  byteLength (): number {
    const writer = new Writer()
    this.writeTo(writer)
    return writer.getBuffer().length
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    writer.writeVarUInt(this.amount)
    return writer
  }

  static fromBuffer (reader: Reader): MinimumDestinationAmountFrame {
    const type = reader.readUInt8BigNum().toNumber()
    if (type !== FrameType.MinimumDestinationAmount) {
      throw new Error(`Cannot read MinimumDestinationAmountFrame from Buffer. Expected type ${FrameType.MinimumDestinationAmount}, got: ${type}`)
    }

    const amount = reader.readVarUInt()
    return new MinimumDestinationAmountFrame(amount)
  }
}

export function isMinimumDestinationAmountFrame (frame: Frame): frame is MinimumDestinationAmountFrame {
  return frame.type === FrameType.MinimumDestinationAmount
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
      case FrameType.SourceAccount:
        frames.push(SourceAccountFrame.fromBuffer(reader))
        break
      case FrameType.AmountArrived:
        frames.push(AmountArrivedFrame.fromBuffer(reader))
        break
      case FrameType.MinimumDestinationAmount:
        frames.push(MinimumDestinationAmountFrame.fromBuffer(reader))
        break
      default:
        throw new Error(`Unknown frame type: ${type}`)
    }
  }
  return frames
}