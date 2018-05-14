import { Reader, Writer, Predictor } from 'oer-utils'
import BigNumber from 'bignumber.js'
import { encrypt, decrypt, ENCRYPTION_OVERHEAD } from './crypto'
import * as assert from 'assert'
require('source-map-support').install()

const VERSION = 1

const ZERO_BYTES = Buffer.alloc(32)
const MAX_UINT64 = new BigNumber('18446744073709551615')

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
  Padding = 0x00,

  ConnectionClose = 0x01,
  ConnectionNewAddress = 0x02,
  ConnectionMaxData = 0x03,
  ConnectionDataBlocked = 0x04,
  ConnectionMaxStreamId = 0x05,
  ConnectionStreamIdBlocked = 0x06,

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
  | ConnectionMaxDataFrame
  | ConnectionDataBlockedFrame
  | ConnectionMaxStreamIdFrame
  | ConnectionStreamIdBlockedFrame
  | StreamMoneyFrame
  | StreamMaxMoneyFrame
  | StreamMoneyBlockedFrame
  | StreamCloseFrame
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
    const numFrames = reader.readVarUIntBigNum().toNumber()
    const frames: Frame[] = []

    for (let i = 0; i < numFrames; i++) {
      const frame = parseFrame(reader)
      if (frame) {
        frames.push(frame)
      }
    }
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
    this.writeTo(writer)
    return writer.getBuffer()
  }

  writeTo (writer: Writer): void {
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

  writeTo (writer: Writer): Writer {
    const properties = Object.getOwnPropertyNames(this).filter((propName: string) => propName !== 'type' && propName !== 'name')

    writer.writeUInt8(this.type)

    const contents = new Writer()
    for (let prop of properties) {
      if (typeof this[prop] === 'number') {
        contents.writeUInt8(this[prop])
      } else if (typeof this[prop] === 'string') {
        contents.writeVarOctetString(Buffer.from(this[prop], 'utf8'))
      } else if (Buffer.isBuffer(this[prop])) {
        contents.writeVarOctetString(this[prop])
      } else if (this[prop] instanceof BigNumber) {
        contents.writeVarUInt(this[prop])
      } else {
        throw new Error(`Unexpected property type for property "${prop}": ${typeof this[prop]}`)
      }
    }

    // TODO don't copy data again
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }

  byteLength (): number {
    const predictor = new Predictor()
    this.writeTo(predictor)
    return predictor.getSize()
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
    const errorCode = reader.readUInt8BigNum().toNumber() as ErrorCode
    const errorMessage = reader.readVarOctetString().toString()
    return new ConnectionCloseFrame(errorCode, errorMessage)
  }
}

export class ConnectionMaxDataFrame extends BaseFrame {
  type: FrameType.ConnectionMaxData
  maxOffset: BigNumber

  constructor (maxOffset: BigNumber.Value) {
    super('ConnectionMaxData')
    this.maxOffset = new BigNumber(maxOffset)
  }

  static fromContents (reader: Reader): ConnectionMaxDataFrame {
    const maxOffset = reader.readVarUIntBigNum()
    return new ConnectionMaxDataFrame(maxOffset)
  }
}

export class ConnectionDataBlockedFrame extends BaseFrame {
  type: FrameType.ConnectionDataBlocked
  maxOffset: BigNumber

  constructor (maxOffset: BigNumber.Value) {
    super('ConnectionDataBlocked')
    this.maxOffset = new BigNumber(maxOffset)
  }

  static fromContents (reader: Reader): ConnectionDataBlockedFrame {
    const maxOffset = reader.readVarUIntBigNum()
    return new ConnectionDataBlockedFrame(maxOffset)
  }
}

export class ConnectionMaxStreamIdFrame extends BaseFrame {
  type: FrameType.ConnectionMaxStreamId
  maxStreamId: BigNumber

  constructor (maxStreamId: BigNumber.Value) {
    super('ConnectionMaxStreamId')
    this.maxStreamId = new BigNumber(maxStreamId)
  }

  static fromContents (reader: Reader): ConnectionMaxStreamIdFrame {
    const maxStreamId = reader.readVarUIntBigNum()
    return new ConnectionMaxStreamIdFrame(maxStreamId)
  }
}

export class ConnectionStreamIdBlockedFrame extends BaseFrame {
  type: FrameType.ConnectionStreamIdBlocked
  maxStreamId: BigNumber

  constructor (maxStreamId: BigNumber.Value) {
    super('ConnectionStreamIdBlocked')
    this.maxStreamId = new BigNumber(maxStreamId)
  }

  static fromContents (reader: Reader): ConnectionStreamIdBlockedFrame {
    const maxStreamId = reader.readVarUIntBigNum()
    return new ConnectionStreamIdBlockedFrame(maxStreamId)
  }
}

export class StreamMoneyFrame extends BaseFrame {
  type: FrameType.StreamMoney
  streamId: BigNumber
  shares: BigNumber

  constructor (streamId: BigNumber.Value, shares: BigNumber.Value) {
    super('StreamMoney')
    this.streamId = new BigNumber(streamId)
    this.shares = new BigNumber(shares)

    assert(this.shares.isInteger() && this.shares.isPositive(), `shares must be a positive integer: ${shares}`)
  }

  static fromContents (reader: Reader): StreamMoneyFrame {
    const streamId = reader.readVarUIntBigNum()
    const amount = reader.readVarUIntBigNum()
    return new StreamMoneyFrame(streamId, amount)
  }
}

export class StreamMaxMoneyFrame extends BaseFrame {
  type: FrameType.StreamMaxMoney
  streamId: BigNumber
  receiveMax: BigNumber
  totalReceived: BigNumber

  constructor (streamId: BigNumber.Value, receiveMax: BigNumber.Value, totalReceived: BigNumber.Value) {
    super('StreamMaxMoney')
    this.streamId = new BigNumber(streamId)
    this.receiveMax = new BigNumber(receiveMax)
    this.totalReceived = new BigNumber(totalReceived)

    if (!this.receiveMax.isFinite()) {
      this.receiveMax = MAX_UINT64
    }

    assert(this.receiveMax.isInteger() && this.receiveMax.isPositive(), `receiveMax must be a positive integer. got: ${receiveMax}`)
    assert(this.totalReceived.isInteger() && this.totalReceived.isPositive(), `totalReceived must be a positive integer. got: ${totalReceived}`)
  }

  static fromContents (reader: Reader): StreamMaxMoneyFrame {
    const streamId = reader.readVarUIntBigNum()
    const receiveMax = reader.readVarUIntBigNum()
    const totalReceived = reader.readVarUIntBigNum()
    return new StreamMaxMoneyFrame(streamId, receiveMax, totalReceived)
  }
}

export class StreamMoneyBlockedFrame extends BaseFrame {
  type: FrameType.StreamMoneyBlocked
  streamId: BigNumber
  sendMax: BigNumber
  totalSent: BigNumber

  constructor (streamId: BigNumber.Value, sendMax: BigNumber.Value, totalSent: BigNumber.Value) {
    super('StreamMoneyBlocked')
    this.streamId = new BigNumber(streamId)
    this.sendMax = new BigNumber(sendMax)
    this.totalSent = new BigNumber(totalSent)

    assert(this.sendMax.isInteger() && this.sendMax.isPositive(), `sendMax must be a positive integer. got: ${sendMax}`)
    assert(this.totalSent.isInteger() && this.totalSent.isPositive(), `totalSent must be a positive integer. got: ${totalSent}`)
  }

  static fromContents (reader: Reader): StreamMoneyBlockedFrame {
    const streamId = reader.readVarUIntBigNum()
    const sendMax = reader.readVarUIntBigNum()
    const totalSent = reader.readVarUIntBigNum()
    return new StreamMoneyBlockedFrame(streamId, sendMax, totalSent)
  }
}

export class StreamCloseFrame extends BaseFrame {
  type: FrameType.StreamClose
  streamId: BigNumber
  errorCode: ErrorCode
  errorMessage: string

  constructor (streamId: BigNumber.Value, errorCode: ErrorCode, errorMessage: string) {
    super('StreamClose')
    this.streamId = new BigNumber(streamId)
    this.errorCode = errorCode
    this.errorMessage = errorMessage
  }

  static fromContents (reader: Reader): StreamCloseFrame {
    const streamId = reader.readVarUIntBigNum()
    const errorCode = reader.readUInt8BigNum().toNumber() as ErrorCode
    const errorMessage = reader.readVarOctetString().toString('utf8')
    return new StreamCloseFrame(streamId, errorCode, errorMessage)
  }
}

export class StreamDataFrame extends BaseFrame {
  type: FrameType.StreamData
  streamId: BigNumber
  offset: BigNumber
  data: Buffer

  constructor (streamId: BigNumber.Value, offset: BigNumber.Value, data: Buffer) {
    super('StreamData')
    this.streamId = new BigNumber(streamId)
    this.offset = new BigNumber(offset)
    this.data = data
  }

  static fromContents (reader: Reader): StreamDataFrame {
    const streamId = reader.readVarUIntBigNum()
    const offset = reader.readVarUIntBigNum()
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
  streamId: BigNumber
  maxOffset: BigNumber

  constructor (streamId: BigNumber.Value, maxOffset: BigNumber.Value) {
    super('StreamMaxData')
    this.streamId = new BigNumber(streamId)
    this.maxOffset = new BigNumber(maxOffset)
  }

  static fromContents (reader: Reader): StreamMaxDataFrame {
    const streamId = reader.readVarUIntBigNum()
    const maxOffset = reader.readVarUIntBigNum()
    return new StreamMaxDataFrame(streamId, maxOffset)
  }
}

export class StreamDataBlockedFrame extends BaseFrame {
  type: FrameType.StreamDataBlocked
  streamId: BigNumber
  maxOffset: BigNumber

  constructor (streamId: BigNumber.Value, maxOffset: BigNumber.Value) {
    super('StreamDataBlocked')
    this.streamId = new BigNumber(streamId)
    this.maxOffset = new BigNumber(maxOffset)
  }

  static fromContents (reader: Reader): StreamDataBlockedFrame {
    const streamId = reader.readVarUIntBigNum()
    const maxOffset = reader.readVarUIntBigNum()
    return new StreamDataBlockedFrame(streamId, maxOffset)
  }
}

function parseFrame (reader: Reader): Frame | undefined {
  const type = reader.readUInt8BigNum().toNumber()
  const contents = Reader.from(reader.readVarOctetString())

  switch (type) {
    case FrameType.ConnectionClose:
      return ConnectionCloseFrame.fromContents(contents)
    case FrameType.ConnectionNewAddress:
      return ConnectionNewAddressFrame.fromContents(contents)
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
