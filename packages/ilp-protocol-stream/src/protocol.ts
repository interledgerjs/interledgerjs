import { Reader, Writer } from 'oer-utils'
import BigNumber from 'bignumber.js'
import { encrypt, decrypt, ENCRYPTION_OVERHEAD } from './crypto'
import 'source-map-support/register'

const VERSION = 1

export class Packet {
  sequence: BigNumber
  ilpPacketType: number
  frames: Frame[]

  constructor (sequence: BigNumber.Value, ilpPacketType: number, frames: Frame[] = []) {
    this.sequence = new BigNumber(sequence)
    this.ilpPacketType = ilpPacketType
    this.frames = frames
  }

  /** @private */
  static _deserializeUnencrypted (buffer: Buffer): Packet {
    const reader = Reader.from(buffer)
    const version = reader.readUInt8BigNum()
    if (!version.isEqualTo(VERSION)) {
      throw new Error(`Unsupported protocol version: ${version}`)
    }
    const ilpPacketType = reader.readUInt8BigNum().toNumber()
    const sequence = reader.readVarUIntBigNum()
    const frames = parseFrames(reader)
    return new Packet(sequence, ilpPacketType, frames)
  }

  static decryptAndDeserialize (sharedSecret: Buffer, buffer: Buffer): Packet {
    let decrypted: Buffer
    try {
      decrypted = decrypt(sharedSecret, buffer)
    } catch (err) {
      throw new Error(`Unable to decrypt packet. Data was corrupted or packet was encrypted with the wrong key`)
    }
    return Packet._deserializeUnencrypted(decrypted)
  }

  /** @private */
  _serialize (): Buffer {
    const writer = new Writer()
    writer.writeUInt8(VERSION)
    writer.writeUInt8(this.ilpPacketType)
    writer.writeVarUInt(this.sequence)
    for (let frame of this.frames) {
      frame.writeTo(writer)
    }
    return writer.getBuffer()
  }

  serializeAndEncrypt (sharedSecret: Buffer, padPacketToSize?: number): Buffer {
    const serialized = this._serialize()
    if (padPacketToSize !== undefined) {
      const paddingSize = padPacketToSize - ENCRYPTION_OVERHEAD - serialized.length
      const zeroBytes = Buffer.alloc(32, 0)
      const args = [sharedSecret, serialized]
      for (let i = 0; i < Math.floor(paddingSize / 32); i++) {
        args.push(zeroBytes)
      }
      args.push(zeroBytes.slice(0, paddingSize % 32))
      return encrypt.apply(null, args)
    }
    return encrypt(sharedSecret, serialized)
  }
}

export enum FrameType {
  // TODO reorder frame numbers to something sensible
  Padding = 0,
  SourceAccount = 1,
  AmountArrived = 2,
  MinimumDestinationAmount = 3,
  StreamMoney = 4,
  StreamMoneyReceiveTotal = 5,
  StreamMoneyClose = 6
}

export abstract class Frame {
  type: number
  name: string

  constructor (type: number, name: string) {
    this.type = type
    this.name = name
  }

  static fromBuffer (reader: Reader): Frame {
    throw new Error(`class method "fromBuffer" is not implemented`)
  }

  abstract writeTo (writer: Writer): Writer
}

export class StreamMoneyFrame extends Frame {
  readonly streamId: BigNumber
  readonly shares: BigNumber
  protected encoded?: Buffer

  constructor (streamId: BigNumber.Value, amount: BigNumber.Value) {
    super(FrameType.StreamMoney, 'StreamMoney')
    this.streamId = new BigNumber(streamId)
    this.shares = new BigNumber(amount)
  }

  static fromBuffer (reader: Reader): StreamMoneyFrame {
    const type = reader.readUInt8BigNum().toNumber()
    if (type !== FrameType.StreamMoney) {
      throw new Error(`Cannot read StreamMoneyFrame from Buffer. Expected type ${FrameType.StreamMoney}, got: ${type}`)
    }

    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const amount = contents.readVarUIntBigNum()
    return new StreamMoneyFrame(streamId, amount)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.streamId)
    contents.writeVarUInt(this.shares)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
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

  static fromBuffer (reader: Reader): SourceAccountFrame {
    const type = reader.readUInt8BigNum().toNumber()
    if (type !== FrameType.SourceAccount) {
      throw new Error(`Cannot read SourceAccountFrame from Buffer. Expected type ${FrameType.SourceAccount}, got: ${type}`)
    }

    const contents = Reader.from(reader.readVarOctetString())
    const sourceAccount = contents.readVarOctetString().toString('utf8')
    return new SourceAccountFrame(sourceAccount)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarOctetString(Buffer.from(this.sourceAccount))
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export function isSourceAccountFrame (frame: Frame): frame is SourceAccountFrame {
  return frame.type === FrameType.SourceAccount
}

export class AmountArrivedFrame extends Frame {
  readonly amount: BigNumber

  constructor (amount: BigNumber.Value) {
    super(FrameType.AmountArrived, 'AmountArrived')
    this.amount = new BigNumber(amount)
  }

  static fromBuffer (reader: Reader): AmountArrivedFrame {
    const type = reader.readUInt8BigNum().toNumber()
    if (type !== FrameType.AmountArrived) {
      throw new Error(`Cannot read AmountArrivedFrame from Buffer. Expected type ${FrameType.AmountArrived}, got: ${type}`)
    }

    const contents = Reader.from(reader.readVarOctetString())
    const amount = contents.readVarUIntBigNum()
    return new AmountArrivedFrame(amount)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.amount)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export function isAmountArrivedFrame (frame: Frame): frame is AmountArrivedFrame {
  return frame.type === FrameType.AmountArrived
}

export class MinimumDestinationAmountFrame extends Frame {
  readonly amount: BigNumber

  constructor (amount: BigNumber.Value) {
    super(FrameType.MinimumDestinationAmount, 'MinimumDestinationAmount')
    this.amount = new BigNumber(amount)
  }

  static fromBuffer (reader: Reader): MinimumDestinationAmountFrame {
    const type = reader.readUInt8BigNum().toNumber()
    if (type !== FrameType.MinimumDestinationAmount) {
      throw new Error(`Cannot read MinimumDestinationAmountFrame from Buffer. Expected type ${FrameType.MinimumDestinationAmount}, got: ${type}`)
    }

    const contents = Reader.from(reader.readVarOctetString())
    const amount = contents.readVarUIntBigNum()
    return new MinimumDestinationAmountFrame(amount)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.amount)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export function isMinimumDestinationAmountFrame (frame: Frame): frame is MinimumDestinationAmountFrame {
  return frame.type === FrameType.MinimumDestinationAmount
}

export class StreamMoneyReceiveTotalFrame extends Frame {
  readonly streamId: BigNumber
  readonly receiveMax: BigNumber
  readonly totalReceived: BigNumber

  constructor (streamId: BigNumber.Value, receiveMax: BigNumber.Value, totalReceived: BigNumber.Value) {
    super(FrameType.StreamMoneyReceiveTotal, 'StreamMoneyReceiveTotal')
    this.streamId = new BigNumber(streamId)
    this.receiveMax = new BigNumber(receiveMax)
    this.totalReceived = new BigNumber(totalReceived)
  }

  static fromBuffer (reader: Reader): StreamMoneyReceiveTotalFrame {
    const type = reader.readUInt8BigNum().toNumber()
    if (type !== FrameType.StreamMoneyReceiveTotal) {
      throw new Error(`Cannot read StreamMoneyReceiveTotalFrame from Buffer. Expected type ${FrameType.StreamMoneyReceiveTotal}, got: ${type}`)
    }

    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const receiveMax = contents.readVarUIntBigNum()
    const totalReceived = contents.readVarUIntBigNum()
    return new StreamMoneyReceiveTotalFrame(streamId, receiveMax, totalReceived)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.streamId)
    contents.writeVarUInt(this.receiveMax)
    contents.writeVarUInt(this.totalReceived)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export function isStreamMoneyReceiveTotalFrame (frame: Frame): frame is StreamMoneyReceiveTotalFrame {
  return frame.type === FrameType.StreamMoneyReceiveTotal
}

export enum StreamErrorCode {
  NoError = 0,
  InternalError = 1,
  ServerBusy = 2,
  FlowControlError = 3,
  StreamIdError = 4,
  StreamStateError = 5
}

export class StreamMoneyCloseFrame extends Frame {
  readonly streamId: BigNumber
  readonly errorCode: StreamErrorCode
  readonly errorMessage: string

  constructor (streamId: BigNumber.Value, errorCode: StreamErrorCode, errorMessage: string) {
    super(FrameType.StreamMoneyClose, 'StreamMoneyClose')
    this.streamId = new BigNumber(streamId)
    this.errorCode = errorCode
    this.errorMessage = errorMessage
  }

  static fromBuffer (reader: Reader): StreamMoneyCloseFrame {
    const type = reader.readUInt8BigNum().toNumber()
    if (type !== FrameType.StreamMoneyClose) {
      throw new Error(`Cannot read StreamMoneyCloseFrame from Buffer. Expected type ${FrameType.StreamMoneyClose}, got: ${type}`)
    }

    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const errorCode = contents.readUInt8BigNum().toNumber()
    const errorMessage = contents.readVarOctetString().toString('utf8')
    return new StreamMoneyCloseFrame(streamId, errorCode, errorMessage)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.streamId)
    contents.writeUInt8(this.errorCode)
    contents.writeVarOctetString(Buffer.from(this.errorMessage, 'utf8'))
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export function isStreamMoneyCloseFrame (frame: Frame): frame is StreamMoneyCloseFrame {
  return frame.type === FrameType.StreamMoneyClose
}

function parseFrame (reader: Reader): Frame | undefined {
  const type = reader.peekUInt8BigNum().toNumber()

  switch (type) {
    case FrameType.Padding:
      reader.skipUInt8()
      return undefined
    case FrameType.StreamMoney:
      return StreamMoneyFrame.fromBuffer(reader)
    case FrameType.SourceAccount:
      return SourceAccountFrame.fromBuffer(reader)
    case FrameType.AmountArrived:
      return AmountArrivedFrame.fromBuffer(reader)
    case FrameType.MinimumDestinationAmount:
      return MinimumDestinationAmountFrame.fromBuffer(reader)
    case FrameType.StreamMoneyReceiveTotal:
      return StreamMoneyReceiveTotalFrame.fromBuffer(reader)
    case FrameType.StreamMoneyClose:
      return StreamMoneyCloseFrame.fromBuffer(reader)
    default:
      reader.skipUInt8()
      reader.skipVarOctetString()
      return undefined
  }
}

function parseFrames (buffer: Reader | Buffer): Frame[] {
  const reader = (Buffer.isBuffer(buffer) ? Reader.from(buffer) : buffer)
  const frames: Frame[] = []

  while (reader.cursor < reader.buffer.length) {
    const frame = parseFrame(reader)
    if (frame) {
      frames.push(frame)
    }
  }
  return frames
}
