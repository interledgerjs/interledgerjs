import { Reader, Writer, Predictor } from 'oer-utils'
import BigNumber from 'bignumber.js'
import { encrypt, decrypt, ENCRYPTION_OVERHEAD } from './crypto'
require('source-map-support').install()

const VERSION = 1

const ZERO_BYTES = Buffer.alloc(32)

export enum IlpPacketType {
  Prepare = 12,
  Fulfill = 13,
  Reject = 14
}

/**
 * ILP STREAM packet
 */
export class Packet {
  sequence: BigNumber
  ilpPacketType: IlpPacketType
  prepareAmount: BigNumber
  frames: Frame[]

  constructor (sequence: BigNumber.Value, ilpPacketType: IlpPacketType, packetAmount: BigNumber.Value = 0, frames: Frame[] = []) {
    this.sequence = new BigNumber(sequence)
    this.ilpPacketType = ilpPacketType
    this.prepareAmount = new BigNumber(packetAmount)
    this.frames = frames
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
  static _deserializeUnencrypted (buffer: Buffer): Packet {
    const reader = Reader.from(buffer)
    const version = reader.readUInt8BigNum()
    if (!version.isEqualTo(VERSION)) {
      throw new Error(`Unsupported protocol version: ${version}`)
    }
    const ilpPacketType = reader.readUInt8BigNum().toNumber()
    const sequence = reader.readVarUIntBigNum()
    const packetAmount = reader.readVarUIntBigNum()
    const frames = parseFrames(reader)
    return new Packet(sequence, ilpPacketType, packetAmount, frames)
  }

  serializeAndEncrypt (sharedSecret: Buffer, padPacketToSize?: number): Buffer {
    const serialized = this._serialize()

    // Pad packet to max data size, if desired
    if (padPacketToSize !== undefined) {
      const paddingSize = padPacketToSize - ENCRYPTION_OVERHEAD - serialized.length
      const args = [sharedSecret, serialized]
      for (let i = 0; i < Math.floor(paddingSize / 32); i++) {
        args.push(ZERO_BYTES)
      }
      args.push(ZERO_BYTES.slice(0, paddingSize % 32))
      return encrypt.apply(null, args)
    }

    return encrypt(sharedSecret, serialized)
  }

  /** @private */
  _serialize (): Buffer {
    const writer = new Writer()
    writer.writeUInt8(VERSION)
    writer.writeUInt8(this.ilpPacketType)
    writer.writeVarUInt(this.sequence)
    writer.writeVarUInt(this.prepareAmount)
    for (let frame of this.frames) {
      frame.writeTo(writer)
    }
    return writer.getBuffer()
  }
}

export enum FrameType {
  Padding = 0x00,

  ConnectionNewAddress = 0x01,
  ConnectionError = 0x02,
  ApplicationError = 0x03,
  ConnectionMaxMoney = 0x04,
  ConnectionMoneyBlocked = 0x05,
  ConnectionMaxData = 0x06,
  ConnectionDataBlocked = 0x07,
  ConnectionMaxStreamId = 0x08,
  ConnectionStreamIdBlocked = 0x09,

  StreamMoney = 0x10,
  StreamMoneyEnd = 0x11,
  StreamMoneyMax = 0x12,
  StreamMoneyBlocked = 0x13,
  StreamMoneyError = 0x14,

  StreamData = 0x20,
  StreamDataEnd = 0x21,
  StreamDataMax = 0x22,
  StreamDataBlocked = 0x23,
  StreamDataError = 0x24
}

export enum ErrorCode {
  NoError = 0x01,
  InternalError = 0x02,
  ServerBusy = 0x03,
  FlowControlError = 0x04,
  StreamIdError = 0x05,
  StreamStateError = 0x06,
  FinalOffsetError = 0x07,
  FrameFormatError = 0x08,
  ProtocolViolation = 0x09
  // TODO add frame-specific errors
}

export abstract class BaseFrame {
  type: FrameType
  name: string

  constructor (name: keyof typeof FrameType) {
    this.type = FrameType[name]
    this.name = name
  }

  static fromBuffer (reader: Reader): BaseFrame {
    throw new Error(`class method "fromBuffer" is not implemented`)
  }

  abstract writeTo (writer: Writer): Writer

  byteLength (): number {
    const predictor = new Predictor()
    this.writeTo(predictor)
    return predictor.getSize()
  }
}

export type Frame =
  ConnectionNewAddressFrame
  | ConnectionErrorFrame
//  | ApplicationErrorFrame
//  | ConnectionMaxMoneyFrame
//  | ConnectionMoneyBlockedFrame
//  | ConnectionMaxDataFrame
//  | ConnectionDataBlockedFrame
//  | ConnectionMaxStreamIdFrame
//  | ConnectionStreamIdBlockedFrame
 | StreamMoneyFrame
 | StreamMoneyMaxFrame
//  | StreamMoneyBlockedFrame
 | StreamMoneyErrorFrame
 | StreamDataFrame
//  | StreamDataMaxFrame
//  | StreamDataBlockedFrame
//  | StreamDataErrorFrame

function assertType (reader: Reader, frameType: keyof typeof FrameType | (keyof typeof FrameType)[], advanceCursor = true): FrameType {
  const type = (advanceCursor ? reader.readUInt8BigNum() : reader.peekUInt8BigNum()).toNumber()
  const acceptableTypes = (Array.isArray(frameType) ? frameType : [frameType]) as (keyof typeof FrameType)[]
  for (let test of acceptableTypes) {
    if (type === FrameType[test]) {
      return type
    }
  }
  throw new Error(`Cannot read ${acceptableTypes.join('Frame or ')} from Buffer. Got type: ${type}, expected type(s): ${acceptableTypes.map((name) => FrameType[name]).join(' or ')}`)
}

export class ConnectionNewAddressFrame extends BaseFrame {
  type: FrameType.ConnectionNewAddress
  sourceAccount: string

  constructor (sourceAccount: string) {
    super('ConnectionNewAddress')
    this.sourceAccount = sourceAccount
  }

  static fromBuffer (reader: Reader): ConnectionNewAddressFrame {
    assertType(reader, 'ConnectionNewAddress')
    const contents = Reader.from(reader.readVarOctetString())
    const sourceAccount = contents.readVarOctetString().toString('utf8')
    return new ConnectionNewAddressFrame(sourceAccount)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarOctetString(Buffer.from(this.sourceAccount))
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class ConnectionErrorFrame extends BaseFrame {
  type: FrameType.ConnectionError
  errorCode: keyof typeof ErrorCode
  errorMessage: string

  constructor (errorCode: keyof typeof ErrorCode, errorMessage: string) {
    super('ConnectionError')
    this.errorCode = errorCode
    this.errorMessage = errorMessage
  }

  static fromBuffer (reader: Reader): ConnectionErrorFrame {
    assertType(reader, 'ConnectionError')
    const contents = Reader.from(reader.readVarOctetString())
    const errorCode = ErrorCode[contents.readUInt8BigNum().toNumber()] as keyof typeof ErrorCode
    const errorMessage = contents.readVarOctetString().toString()
    return new ConnectionErrorFrame(errorCode, errorMessage)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeUInt8(ErrorCode[this.errorCode])
    contents.writeVarOctetString(Buffer.from(this.errorMessage))
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class StreamMoneyFrame extends BaseFrame {
  type: FrameType.StreamMoney | FrameType.StreamMoneyEnd
  streamId: BigNumber
  shares: BigNumber
  isEnd: boolean

  constructor (streamId: BigNumber.Value, amount: BigNumber.Value, isEnd = false) {
    super((isEnd ? 'StreamMoneyEnd' : 'StreamMoney'))
    this.streamId = new BigNumber(streamId)
    this.shares = new BigNumber(amount)
    this.isEnd = isEnd
  }

  static fromBuffer (reader: Reader): StreamMoneyFrame {
    const type = assertType(reader, ['StreamMoney', 'StreamMoneyEnd'])
    const isEnd = (type === FrameType.StreamMoneyEnd)
    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const amount = contents.readVarUIntBigNum()
    return new StreamMoneyFrame(streamId, amount, isEnd)
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

export class StreamMoneyMaxFrame extends BaseFrame {
  type: FrameType.StreamMoneyMax
  streamId: BigNumber
  receiveMax: BigNumber
  totalReceived: BigNumber

  constructor (streamId: BigNumber.Value, receiveMax: BigNumber.Value, totalReceived: BigNumber.Value) {
    super('StreamMoneyMax')
    this.streamId = new BigNumber(streamId)
    this.receiveMax = new BigNumber(receiveMax)
    this.totalReceived = new BigNumber(totalReceived)
  }

  static fromBuffer (reader: Reader): StreamMoneyMaxFrame {
    assertType(reader, 'StreamMoneyMax')
    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const receiveMax = contents.readVarUIntBigNum()
    const totalReceived = contents.readVarUIntBigNum()
    return new StreamMoneyMaxFrame(streamId, receiveMax, totalReceived)
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

export class StreamMoneyErrorFrame extends BaseFrame {
  type: FrameType.StreamMoneyError
  streamId: BigNumber
  errorCode: keyof typeof ErrorCode
  errorMessage: string

  constructor (streamId: BigNumber.Value, errorCode: keyof typeof ErrorCode, errorMessage: string) {
    super('StreamMoneyError')
    this.streamId = new BigNumber(streamId)
    this.errorCode = errorCode
    this.errorMessage = errorMessage
  }

  static fromBuffer (reader: Reader): StreamMoneyErrorFrame {
    assertType(reader, 'StreamMoneyError')
    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const errorCode = ErrorCode[contents.readUInt8BigNum().toNumber()] as keyof typeof ErrorCode
    const errorMessage = contents.readVarOctetString().toString('utf8')
    return new StreamMoneyErrorFrame(streamId, errorCode, errorMessage)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.streamId)
    contents.writeUInt8(ErrorCode[this.errorCode])
    contents.writeVarOctetString(Buffer.from(this.errorMessage, 'utf8'))
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class StreamDataFrame extends BaseFrame {
  type: FrameType.StreamData | FrameType.StreamDataEnd
  streamId: BigNumber
  offset: BigNumber
  data: Buffer
  isEnd: boolean

  constructor (streamId: BigNumber.Value, offset: BigNumber.Value, data: Buffer, isEnd = false) {
    super((isEnd ? 'StreamDataEnd' : 'StreamData'))
    this.streamId = new BigNumber(streamId)
    this.offset = new BigNumber(offset)
    this.data = data
    this.isEnd = isEnd
  }

  static fromBuffer (reader: Reader): StreamDataFrame {
    const type = assertType(reader, ['StreamData', 'StreamDataEnd'])
    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const offset = contents.readVarUIntBigNum()
    const data = contents.readVarOctetString()
    return new StreamDataFrame(streamId, offset, data)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.streamId)
    contents.writeVarUInt(this.offset)
    contents.writeVarOctetString(this.data)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

function parseFrame (reader: Reader): Frame | undefined {
  const type = reader.peekUInt8BigNum().toNumber()

  switch (type) {
    case FrameType.StreamMoney:
      return StreamMoneyFrame.fromBuffer(reader)
    case FrameType.ConnectionNewAddress:
      return ConnectionNewAddressFrame.fromBuffer(reader)
    case FrameType.ConnectionError:
      return ConnectionErrorFrame.fromBuffer(reader)
    case FrameType.StreamMoneyMax:
      return StreamMoneyMaxFrame.fromBuffer(reader)
    case FrameType.StreamMoneyError:
      return StreamMoneyErrorFrame.fromBuffer(reader)
    case FrameType.StreamData:
      return StreamDataFrame.fromBuffer(reader)
    default:
      reader.skipUInt8()
      reader.skipVarOctetString()
      return undefined
  }
}

function parseFrames (buffer: Reader | Buffer): Frame[] {
  const reader = (Buffer.isBuffer(buffer) ? Reader.from(buffer) : buffer)
  const frames: Frame[] = []

  // Keep reading frames until the end or until we hit the padding (which must come at the end)
  while (reader.cursor < reader.buffer.length
    && !reader.peekUInt8BigNum().isEqualTo(FrameType.Padding)) {
    const frame = parseFrame(reader)
    if (frame) {
      frames.push(frame)
    }
  }
  return frames
}
