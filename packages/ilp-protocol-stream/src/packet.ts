import { Reader, Writer, WriterInterface, Predictor } from 'oer-utils'
import * as Long from 'long'
import { encrypt, decrypt, ENCRYPTION_OVERHEAD } from './crypto'
import { LongValue, longFromValue } from './util/long'

const VERSION = Long.fromNumber(1, true)

const ZERO_BYTES = Buffer.alloc(32)

/**
 * ILPv4 Packet Type Identifiers
 */
export enum IlpPacketType {
  Prepare = 12,
  Fulfill = 13,
  Reject = 14
}

/**
 * STREAM Protocol Error Codes
 */
export enum ErrorCode {
  NoError = 0x01,
  InternalError = 0x02,
  EndpointBusy = 0x03,
  FlowControlError = 0x04,
  StreamIdError = 0x05,
  StreamStateError = 0x06,
  FrameFormatError = 0x07,
  ProtocolViolation = 0x08,
  ApplicationError = 0x09
}

/**
 * STREAM Protocol Frame Identifiers
 */
export enum FrameType {
  ConnectionClose = 0x01,
  ConnectionNewAddress = 0x02,
  ConnectionMaxData = 0x03,
  ConnectionDataBlocked = 0x04,
  ConnectionMaxStreamId = 0x05,
  ConnectionStreamIdBlocked = 0x06,
  ConnectionAssetDetails = 0x07,

  StreamClose = 0x10,
  StreamMoney = 0x11,
  StreamMaxMoney = 0x12,
  StreamMoneyBlocked = 0x13,
  StreamData = 0x14,
  StreamMaxData = 0x15,
  StreamDataBlocked = 0x16
}

/**
 * All of the frames included in the STREAM protocol
 */
export type Frame =
  ConnectionCloseFrame
  | ConnectionNewAddressFrame
  | ConnectionAssetDetailsFrame
  | ConnectionMaxDataFrame
  | ConnectionDataBlockedFrame
  | ConnectionMaxStreamIdFrame
  | ConnectionStreamIdBlockedFrame
  | StreamCloseFrame
  | StreamMoneyFrame
  | StreamMaxMoneyFrame
  | StreamMoneyBlockedFrame
  | StreamDataFrame
  | StreamMaxDataFrame
  | StreamDataBlockedFrame

/**
 * STREAM Protocol Packet
 *
 * Each packet is comprised of a header and zero or more Frames.
 * Packets are serialized, encrypted, and sent as the data field in ILP Packets.
 */
export class Packet {
  sequence: Long
  ilpPacketType: IlpPacketType
  prepareAmount: Long
  frames: Frame[]

  constructor (
    sequence: LongValue,
    ilpPacketType: IlpPacketType,
    packetAmount: LongValue = Long.UZERO,
    frames: Frame[] = []
  ) {
    this.sequence = longFromValue(sequence, true)
    this.ilpPacketType = ilpPacketType
    this.prepareAmount = longFromValue(packetAmount, true)
    this.frames = frames
  }

  static async decryptAndDeserialize (pskEncryptionKey: Buffer, buffer: Buffer): Promise<Packet> {
    let decrypted: Buffer
    try {
      decrypted = await decrypt(pskEncryptionKey, buffer)
    } catch (err) {
      throw new Error(`Unable to decrypt packet. Data was corrupted or packet was encrypted with the wrong key`)
    }
    return Packet._deserializeUnencrypted(decrypted)
  }

  /** @private */
  static _deserializeUnencrypted (buffer: Buffer): Packet {
    const reader = Reader.from(buffer)
    const version = reader.readUInt8Long()
    if (!version.equals(VERSION)) {
      throw new Error(`Unsupported protocol version: ${version}`)
    }
    const ilpPacketType = reader.readUInt8Number()
    const sequence = reader.readVarUIntLong()
    const packetAmount = reader.readVarUIntLong()
    const numFrames = reader.readVarUIntNumber()
    const frames: Frame[] = []

    for (let i = 0; i < numFrames; i++) {
      const frame = parseFrame(reader)
      if (frame) {
        frames.push(frame)
      }
    }
    return new Packet(sequence, ilpPacketType, packetAmount, frames)
  }

  serializeAndEncrypt (pskEncryptionKey: Buffer, padPacketToSize?: number): Promise<Buffer> {
    const serialized = this._serialize()

    // Pad packet to max data size, if desired
    if (padPacketToSize !== undefined) {
      const paddingSize = padPacketToSize - ENCRYPTION_OVERHEAD - serialized.length
      const args = [pskEncryptionKey, serialized]
      for (let i = 0; i < Math.floor(paddingSize / 32); i++) {
        args.push(ZERO_BYTES)
      }
      args.push(ZERO_BYTES.slice(0, paddingSize % 32))
      return encrypt.apply(null, args)
    }

    return encrypt(pskEncryptionKey, serialized)
  }

  /** @private */
  _serialize (): Buffer {
    const predictor = new Predictor()
    this.writeTo(predictor)
    const writer = new Writer(predictor.length)
    this.writeTo(writer)
    return writer.getBuffer()
  }

  writeTo (writer: WriterInterface): void {
    // Write the packet header
    writer.writeUInt8(VERSION)
    writer.writeUInt8(this.ilpPacketType)
    writer.writeVarUInt(this.sequence)
    writer.writeVarUInt(this.prepareAmount)

    // Write the number of frames (excluding padding)
    writer.writeVarUInt(this.frames.length)

    // Write each of the frames
    for (let frame of this.frames) {
      frame.writeTo(writer)
    }
  }

  byteLength (): number {
    const predictor = new Predictor()
    this.writeTo(predictor)
    return predictor.getSize() + ENCRYPTION_OVERHEAD
  }
}

/**
 * Base class that each Frame extends
 */
export abstract class BaseFrame {
  type: FrameType
  name: string

  constructor (name: keyof typeof FrameType) {
    this.type = FrameType[name]
    this.name = name
  }

  static fromContents (reader: Reader): BaseFrame {
    throw new Error(`class method "fromContents" is not implemented`)
  }

  writeTo<T extends WriterInterface> (writer: T): T {
    const predictor = new Predictor()
    this.writeContentsTo(predictor)
    writer.writeUInt8(this.type)
    this.writeContentsTo(writer.createVarOctetString(predictor.length))
    return writer
  }

  protected writeContentsTo (contents: WriterInterface) {
    const properties = Object.getOwnPropertyNames(this).filter((propName: string) => propName !== 'type' && propName !== 'name')
    for (let prop of properties) {
      const value = this[prop]
      if (typeof value === 'number') {
        contents.writeUInt8(value)
      } else if (typeof value === 'string') {
        contents.writeVarOctetString(Buffer.from(value, 'utf8'))
      } else if (Buffer.isBuffer(value)) {
        contents.writeVarOctetString(value)
      } else if (Long.isLong(value)) {
        contents.writeVarUInt(value)
      } else {
        throw new Error(`Unexpected property type for property "${prop}": ${typeof value}`)
      }
    }
  }

  byteLength (): number {
    const predictor = new Predictor()
    this.writeTo(predictor)
    return predictor.getSize()
  }
}

export class ConnectionCloseFrame extends BaseFrame {
  type: FrameType.ConnectionClose
  errorCode: ErrorCode
  errorMessage: string

  constructor (errorCode: ErrorCode, errorMessage: string) {
    super('ConnectionClose')
    this.errorCode = errorCode
    this.errorMessage = errorMessage
  }

  static fromContents (reader: Reader): ConnectionCloseFrame {
    const errorCode = reader.readUInt8Number() as ErrorCode
    const errorMessage = reader.readVarOctetString().toString()
    return new ConnectionCloseFrame(errorCode, errorMessage)
  }
}

export class ConnectionNewAddressFrame extends BaseFrame {
  type: FrameType.ConnectionNewAddress
  sourceAccount: string

  constructor (sourceAccount: string) {
    super('ConnectionNewAddress')
    this.sourceAccount = sourceAccount
  }

  static fromContents (reader: Reader): ConnectionNewAddressFrame {
    const sourceAccount = reader.readVarOctetString().toString('utf8')
    return new ConnectionNewAddressFrame(sourceAccount)
  }
}

export class ConnectionAssetDetailsFrame extends BaseFrame {
  type: FrameType.ConnectionAssetDetails
  sourceAssetCode: string
  sourceAssetScale: number

  constructor (sourceAssetCode: string, sourceAssetScale: number) {
    super('ConnectionAssetDetails')
    this.sourceAssetCode = sourceAssetCode
    this.sourceAssetScale = sourceAssetScale
  }

  static fromContents (reader: Reader): ConnectionAssetDetailsFrame {
    const sourceAssetCode = reader.readVarOctetString().toString('utf8')
    const sourceAssetScale = reader.readUInt8Number()
    return new ConnectionAssetDetailsFrame(sourceAssetCode, sourceAssetScale)
  }
}

export class ConnectionMaxDataFrame extends BaseFrame {
  type: FrameType.ConnectionMaxData
  maxOffset: Long

  constructor (maxOffset: LongValue) {
    super('ConnectionMaxData')
    this.maxOffset = longFromValue(maxOffset, true)
  }

  static fromContents (reader: Reader): ConnectionMaxDataFrame {
    const maxOffset = reader.readVarUIntLong()
    return new ConnectionMaxDataFrame(maxOffset)
  }
}

export class ConnectionDataBlockedFrame extends BaseFrame {
  type: FrameType.ConnectionDataBlocked
  maxOffset: Long

  constructor (maxOffset: LongValue) {
    super('ConnectionDataBlocked')
    this.maxOffset = longFromValue(maxOffset, true)
  }

  static fromContents (reader: Reader): ConnectionDataBlockedFrame {
    const maxOffset = reader.readVarUIntLong()
    return new ConnectionDataBlockedFrame(maxOffset)
  }
}

export class ConnectionMaxStreamIdFrame extends BaseFrame {
  type: FrameType.ConnectionMaxStreamId
  maxStreamId: Long

  constructor (maxStreamId: LongValue) {
    super('ConnectionMaxStreamId')
    this.maxStreamId = longFromValue(maxStreamId, true)
  }

  static fromContents (reader: Reader): ConnectionMaxStreamIdFrame {
    const maxStreamId = reader.readVarUIntLong()
    return new ConnectionMaxStreamIdFrame(maxStreamId)
  }
}

export class ConnectionStreamIdBlockedFrame extends BaseFrame {
  type: FrameType.ConnectionStreamIdBlocked
  maxStreamId: Long

  constructor (maxStreamId: LongValue) {
    super('ConnectionStreamIdBlocked')
    this.maxStreamId = longFromValue(maxStreamId, true)
  }

  static fromContents (reader: Reader): ConnectionStreamIdBlockedFrame {
    const maxStreamId = reader.readVarUIntLong()
    return new ConnectionStreamIdBlockedFrame(maxStreamId)
  }
}

export class StreamCloseFrame extends BaseFrame {
  type: FrameType.StreamClose
  streamId: Long
  errorCode: ErrorCode
  errorMessage: string

  constructor (streamId: LongValue, errorCode: ErrorCode, errorMessage: string) {
    super('StreamClose')
    this.streamId = longFromValue(streamId, true)
    this.errorCode = errorCode
    this.errorMessage = errorMessage
  }

  static fromContents (reader: Reader): StreamCloseFrame {
    const streamId = reader.readVarUIntLong()
    const errorCode = reader.readUInt8Number() as ErrorCode
    const errorMessage = reader.readVarOctetString().toString('utf8')
    return new StreamCloseFrame(streamId, errorCode, errorMessage)
  }
}

export class StreamMoneyFrame extends BaseFrame {
  type: FrameType.StreamMoney
  streamId: Long
  shares: Long

  constructor (streamId: LongValue, shares: LongValue) {
    super('StreamMoney')
    this.streamId = longFromValue(streamId, true)
    this.shares = longFromValue(shares, true)
  }

  static fromContents (reader: Reader): StreamMoneyFrame {
    const streamId = reader.readVarUIntLong()
    const amount = reader.readVarUIntLong()
    return new StreamMoneyFrame(streamId, amount)
  }
}

export class StreamMaxMoneyFrame extends BaseFrame {
  type: FrameType.StreamMaxMoney
  streamId: Long
  receiveMax: Long
  totalReceived: Long

  constructor (streamId: LongValue, receiveMax: LongValue, totalReceived: LongValue) {
    super('StreamMaxMoney')
    if (typeof receiveMax === 'number' && !isFinite(receiveMax)) {
      receiveMax = Long.MAX_UNSIGNED_VALUE
    }

    this.streamId = longFromValue(streamId, true)
    this.receiveMax = longFromValue(receiveMax, true)
    this.totalReceived = longFromValue(totalReceived, true)
  }

  static fromContents (reader: Reader): StreamMaxMoneyFrame {
    const streamId = reader.readVarUIntLong()
    const receiveMax = saturatingReadVarUInt(reader)
    const totalReceived = reader.readVarUIntLong()
    return new StreamMaxMoneyFrame(streamId, receiveMax, totalReceived)
  }
}

export class StreamMoneyBlockedFrame extends BaseFrame {
  type: FrameType.StreamMoneyBlocked
  streamId: Long
  sendMax: Long
  totalSent: Long

  constructor (streamId: LongValue, sendMax: LongValue, totalSent: LongValue) {
    super('StreamMoneyBlocked')
    this.streamId = longFromValue(streamId, true)
    this.sendMax = longFromValue(sendMax, true)
    this.totalSent = longFromValue(totalSent, true)
  }

  static fromContents (reader: Reader): StreamMoneyBlockedFrame {
    const streamId = reader.readVarUIntLong()
    const sendMax = saturatingReadVarUInt(reader)
    const totalSent = reader.readVarUIntLong()
    return new StreamMoneyBlockedFrame(streamId, sendMax, totalSent)
  }
}

export class StreamDataFrame extends BaseFrame {
  type: FrameType.StreamData
  streamId: Long
  offset: Long
  data: Buffer

  constructor (streamId: LongValue, offset: LongValue, data: Buffer) {
    super('StreamData')
    this.streamId = longFromValue(streamId, true)
    this.offset = longFromValue(offset, true)
    this.data = data
  }

  static fromContents (reader: Reader): StreamDataFrame {
    const streamId = reader.readVarUIntLong()
    const offset = reader.readVarUIntLong()
    const data = reader.readVarOctetString()
    return new StreamDataFrame(streamId, offset, data)
  }

  // Leave out the data because that may be very long
  toJSON (): Object {
    return {
      type: this.type,
      name: this.name,
      streamId: this.streamId,
      offset: this.offset,
      dataLength: this.data.length
    }
  }
}

export class StreamMaxDataFrame extends BaseFrame {
  type: FrameType.StreamMaxData
  streamId: Long
  maxOffset: Long

  constructor (streamId: LongValue, maxOffset: LongValue) {
    super('StreamMaxData')
    this.streamId = longFromValue(streamId, true)
    this.maxOffset = longFromValue(maxOffset, true)
  }

  static fromContents (reader: Reader): StreamMaxDataFrame {
    const streamId = reader.readVarUIntLong()
    const maxOffset = reader.readVarUIntLong()
    return new StreamMaxDataFrame(streamId, maxOffset)
  }
}

export class StreamDataBlockedFrame extends BaseFrame {
  type: FrameType.StreamDataBlocked
  streamId: Long
  maxOffset: Long

  constructor (streamId: LongValue, maxOffset: LongValue) {
    super('StreamDataBlocked')
    this.streamId = longFromValue(streamId, true)
    this.maxOffset = longFromValue(maxOffset, true)
  }

  static fromContents (reader: Reader): StreamDataBlockedFrame {
    const streamId = reader.readVarUIntLong()
    const maxOffset = reader.readVarUIntLong()
    return new StreamDataBlockedFrame(streamId, maxOffset)
  }
}

function parseFrame (reader: Reader): Frame | undefined {
  const type = reader.readUInt8Number()
  const contents = Reader.from(reader.readVarOctetString())

  switch (type) {
    case FrameType.ConnectionClose:
      return ConnectionCloseFrame.fromContents(contents)
    case FrameType.ConnectionNewAddress:
      return ConnectionNewAddressFrame.fromContents(contents)
    case FrameType.ConnectionAssetDetails:
      return ConnectionAssetDetailsFrame.fromContents(contents)
    case FrameType.ConnectionMaxData:
      return ConnectionMaxDataFrame.fromContents(contents)
    case FrameType.ConnectionDataBlocked:
      return ConnectionDataBlockedFrame.fromContents(contents)
    case FrameType.ConnectionMaxStreamId:
      return ConnectionMaxStreamIdFrame.fromContents(contents)
    case FrameType.ConnectionStreamIdBlocked:
      return ConnectionStreamIdBlockedFrame.fromContents(contents)
    case FrameType.StreamClose:
      return StreamCloseFrame.fromContents(contents)
    case FrameType.StreamMoney:
      return StreamMoneyFrame.fromContents(contents)
    case FrameType.StreamMaxMoney:
      return StreamMaxMoneyFrame.fromContents(contents)
    case FrameType.StreamMoneyBlocked:
      return StreamMoneyBlockedFrame.fromContents(contents)
    case FrameType.StreamData:
      return StreamDataFrame.fromContents(contents)
    case FrameType.StreamMaxData:
      return StreamMaxDataFrame.fromContents(contents)
    case FrameType.StreamDataBlocked:
      return StreamDataBlockedFrame.fromContents(contents)
    default:
      return undefined
  }
}

// Behaves like `readVarUIntLong`, but returns `Long.MAX_UNSIGNED_VALUE` if the
// VarUInt is too large to fit in a UInt64.
function saturatingReadVarUInt (reader: Reader): Long {
  if (reader.peekVarOctetString().length > 8) {
    reader.skipVarOctetString()
    return Long.MAX_UNSIGNED_VALUE
  } else {
    return reader.readVarUIntLong()
  }
}
