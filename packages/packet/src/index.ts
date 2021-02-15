// TODO Serialize ILP Prepare

import { INTERLEDGER_TIME_LENGTH } from '../../ilp-packet/src/utils/date'
import {
  IlpPacketType,
  IlpPrepare,
  isValidIlpAddress,
  IlpFulfill,
  IlpReject,
  IlpAddress,
} from '../../ilp-packet/src'
import { Int } from '../../pay/src/utils'

interface IlpPrepareBuilder {
  setAmount(amount: Int): this // TODO Should this be a long/u64 type ?

  setExpiration(expiresAt: Date): this
  setExpiration(expiresAt: string): this | undefined

  setDestination(address: IlpAddress): this
  setDestination(address: string): this | undefined

  setExecutionCondition(executionCondition: Uint8Array): this | undefined // TODO Require byteLength=32 !

  setData(): this // TODO Method to create stream packet inline without allocating/copying multiple times?
  setData(encoder: Encoder): this | undefined // TODO encoder.byteLength < 65k

  serialize(): ArrayBuffer // TODO
}

interface IlpPrepare {
  amount: Int // TODO Create @interledger/numbers package for Longs?
  expiresAt: number // TODO unix timestamp -- use `NonNegativeNumber` type?
}

const serializeIlpPrepare = (prepare: {
  destination: string
  expiresAt: Date
  executionCondition: Uint8Array
  amount: bigint
  data: Uint8Array // TODO this should be its own encoder for more efficiency? Or does it not matter with the crypto?
}): ArrayBuffer =>
  new MultiFieldEncoder(
    new Uint8Encoder(IlpPacketType.Prepare),
    // TODO why is the envelope necessary if each field has it's own length prefix?
    new VarFieldEncoder(
      new MultiFieldEncoder(
        new Uint64Encoder(prepare.amount),
        new StringEncoder('TODO timestamp'), // Timestamp is a fixed length
        new BufferEncoder(prepare.executionCondition),
        new VarFieldEncoder(new StringEncoder(prepare.destination)),
        new VarFieldEncoder(new BufferEncoder(prepare.data))
      )
    )
  ).allocate()

const deserializeIlpPrepare = (buffer: ArrayBuffer) => {
  // TODO How to structure return value...?
}

const serializeIlpReject = (reject: {
  code: string
  triggeredBy: string
  message: string
  data: Uint8Array
}): ArrayBuffer =>
  new MultiFieldEncoder(
    new Uint8Encoder(IlpPacketType.Reject),
    new VarFieldEncoder(
      new MultiFieldEncoder(
        new StringEncoder(reject.code),
        new VarFieldEncoder(new StringEncoder(reject.triggeredBy)),
        new VarFieldEncoder(new StringEncoder(reject.message)),
        new VarFieldEncoder(new BufferEncoder(reject.data))
      )
    )
  ).allocate()

const serializeIlpFulfill = (fulfill: { fulfillment: Uint8Array; data: Uint8Array }): ArrayBuffer =>
  new MultiFieldEncoder(
    new Uint8Encoder(IlpPacketType.Fulfill),
    new VarFieldEncoder(
      new MultiFieldEncoder(
        new BufferEncoder(fulfill.fulfillment),
        new VarFieldEncoder(new BufferEncoder(fulfill.data))
      )
    )
  ).allocate()

// TODO Is there a way to in-place encryption?
// TODO Encode STREAM packets, too?
const serializeStreamEnvelope = (ciphertext: Uint8Array): ArrayBuffer =>
  new MultiFieldEncoder(
    // TODO 96-bit IV
    // TODO 128-bit auth tag
    new BufferEncoder(ciphertext) // not sure this is variable? it's just the remainder of the packet
  ).allocate()

const serializeStreamPacket = (
  packetType: IlpPacketType,
  sequence: number,
  prepareAmount: bigint
): ArrayBuffer => {
  // TODO
  return new MultiFieldEncoder(
    new Uint8Encoder(1), // version
    new Uint8Encoder(packetType),
    new VarFieldEncoder(new Uint32Encoder(sequence)),
    new VarFieldEncoder(new Uint64Encoder(prepareAmount))
    // TODO Number of frames as Varuint ?
    // TODO Add all stream frames here...
  ).allocate()
}
// Note: TextEncoder global is only available on Node 11+, otherwise it's within the `util` module
// Should I use Sindre's hack to require it from util?

abstract class Encoder {
  abstract byteLength: number

  abstract write(buffer: ArrayBuffer, offset: number): void

  allocate(): ArrayBuffer {
    const buffer = new ArrayBuffer(this.byteLength)
    this.write(buffer, 0)
    return buffer
  }
}

class Decoder {
  private static textDecoder = new TextDecoder()

  private readonly buffer: ArrayBuffer // TODO Use a `DataView` here instead? Then it only needs to be constructed once for reuse
  private readonly start: number
  private readonly end: number

  private cursor: number // Necessary for calls to read multiple fields

  constructor(buffer: ArrayBuffer, start?: number, end?: number) {
    this.buffer = buffer

    this.start = start ?? 0
    this.end = end ?? buffer.byteLength - this.start

    this.cursor = this.start
  }

  private get remainingLength(): number {
    return this.end - this.cursor
  }

  private areBytesAvailable(requiredBytes: number): boolean {
    return this.remainingLength >= requiredBytes
  }

  readVarField(): Decoder | undefined {
    const view = new DataView(this.buffer, this.cursor)

    // Read the length determinant prefix
    if (!this.areBytesAvailable(1)) return
    const determinant = view.getUint8(0)
    this.cursor++

    // Compute the length of the variable field
    let length: number
    if (determinant <= 127) {
      // "Short form" determinant
      length = determinant
    } else if (determinant === 130) {
      // Since all ILP variable length fields are < 65436 bytes,
      // the "long form" determinant should always fit within 2 bytes
      // Thus, the determinant is 127 + 1 + 2 = 130
      if (!this.areBytesAvailable(2)) return
      this.cursor += 2
      length = view.getUint16(1)
    } else {
      return
    }

    if (!this.areBytesAvailable(length)) return
    const start = this.cursor
    this.cursor += length
    return new Decoder(this.buffer, start, start + length)
  }

  readBuffer(byteLength = this.remainingLength): Uint8Array | undefined {
    if (!this.areBytesAvailable(byteLength)) return

    this.cursor += byteLength
    return new Uint8Array(this.buffer, this.cursor, byteLength)
  }

  readString(length = this.remainingLength): string | undefined {
    if (!this.areBytesAvailable(length)) return

    const view = new Uint8Array(this.buffer, this.cursor, length)

    this.cursor += length
    return Decoder.textDecoder.decode(view)
  }

  // TODO Or, this could just attempt to read whatever the remaining length is...
  // I think this needs to be able to read, e.g. 3, 5, 6, 7 bytes... (and write, too!)
  // readVarUint(): bigint | undefined {
  //   return this.remainingLength === 1
  //     ? this.readUint8()
  //     : this.remainingLength === 2
  //     ? this.readUint16()
  //     : this.remainingLength === 4
  //     ? this.readUint32()
  //     : this.remainingLength === 8
  //     ? this.readUint64()
  //     : undefined

  //   const view = new DataView(this.buffer, this.cursor, 1)
  //   const length = view.getUint8(0)
  //   this.cursor++
  // }

  readUint8(): number | undefined {
    if (!this.areBytesAvailable(1)) return

    this.cursor++
    return new Uint8Array(this.buffer, this.cursor, 1)[0]
  }

  readUint64(): bigint | undefined {
    if (!this.areBytesAvailable(8)) return

    const view = new DataView(this.buffer, this.cursor, 8)

    this.cursor += 8
    if ('getBigUint64' in DataView.prototype) {
      return view.getBigUint64(0)
    } else {
      // Polyfill for Safari 14 (supports BigInt but not getBigUint64)
      const lsb = BigInt(view.getUint32(4))
      const gsb = BigInt(view.getUint32(0))
      return lsb + BigInt(4294967296) * gsb
    }
  }

  // TODO Add/decode varuint up to u64? Some uses in STREAM (?)
}

// TODO Create separate classes
class IlpPrepareDecoder extends Decoder {
  readIlpPrepare(): IlpPrepare | undefined {
    const packetType = this.readUint8()
    if (packetType !== IlpPacketType.Prepare) {
      return
    }

    const content = this.readVarField()
    if (!content) return

    const amount = content.readUint64()
    if (!amount) return

    const rawTimestamp = content.readString(INTERLEDGER_TIME_LENGTH)
    if (!rawTimestamp) return

    // TODO Date.UTC -> unix ms timestamp, just use that instead? But validate not `NaN`
    const expiresAt = new Date(
      Date.UTC(
        +rawTimestamp.slice(0, 4), // year
        +rawTimestamp.slice(4, 6) - 1, // month
        +rawTimestamp.slice(6, 8), // day
        +rawTimestamp.slice(8, 10), // hours
        +rawTimestamp.slice(10, 12), // minutes
        +rawTimestamp.slice(12, 14), // seconds
        +rawTimestamp.slice(14, 17) // milliseconds
      )
    )
    if (!expiresAt.valueOf()) {
      return // Invalid date
    }

    const executionCondition = content.readBuffer(32)
    if (!executionCondition) return

    const destination = content.readVarField()?.readString()
    if (!isValidIlpAddress(destination)) return

    const data = content.readVarField()?.readBuffer()
    if (!data || data.byteLength > MAX_DATA_LENGTH) return

    return {
      amount,
      executionCondition,
      expiresAt,
      destination,
      data,
    }
  }

  readIlpReject(): IlpReject | undefined {
    // TODO
  }

  readIlpFulfill(): IlpFulfill | undefined {
    const packetType = this.readUint8()
    if (packetType !== IlpPacketType.Fulfill) {
      return
    }

    const content = this.readVarField()
    if (!content) return

    const fulfillment = content.readBuffer(32)
    if (!fulfillment) return

    const data = content.readVarField()?.readBuffer()
    if (!data || data.byteLength > MAX_DATA_LENGTH) return

    return {
      fulfillment,
      data,
    }
  }
}

/**
 * TODO What frames do I need to implement?
 * - StreamClose
 * - StreamMoney
 * - StreamReceipt
 * - ConnectionClose
 * - ConnectionMaxStreamId
 */

// TODO Or could this internally be, MultiFieldEncoder(Uint64Encoder, Uint64Encoder) ?
class MaxPacketAmountEncoder extends Encoder {
  get byteLength(): number {
    return 16
  }

  write(buffer: ArrayBuffer, offset: number) {
    const view = new DataView(buffer, offset)
    view.setBigUint64(0, BigInt(0)) // TODO Add this as property
    view.setBigUint64(8, BigInt(1)) // TODO Add this as property
  }
}

class Uint8Encoder extends Encoder {
  private value: number

  constructor(value: number) {
    super()
    this.value = value // TODO Ensure within u8 range, etc.
  }

  readonly byteLength = 1

  write(buffer: ArrayBuffer, offset: number) {
    const view = new DataView(buffer, offset)
    view.setUint8(0, this.value)
  }
}

// TODO Where is this used? Stream sequence number?
class Uint32Encoder extends Encoder {
  private value: number

  constructor(value: number) {
    super()
    this.value = value
  }

  readonly byteLength = 4

  write(buffer: ArrayBuffer, offset: number) {
    const view = new DataView(buffer, offset)
    view.setUint32(0, this.value)
  }
}

class Uint64Encoder extends Encoder {
  private value: bigint

  constructor(value: bigint) {
    super()
    this.value = value
  }

  readonly byteLength = 8

  write(buffer: ArrayBuffer, offset: number) {
    const view = new DataView(buffer, offset)
    view.setBigUint64(0, this.value)
  }
}

// TODO Rename to "LengthPrefixEncoder"?
class VarFieldEncoder extends Encoder {
  private content: Encoder

  constructor(content: Encoder) {
    super()
    // TODO Ensure content <= 65436 bytes / fits within u16
    this.content = content
  }

  private get isShortForm() {
    return this.content.byteLength <= 127
  }

  get byteLength() {
    return this.isShortForm ? 1 : 3
  }

  write(buffer: ArrayBuffer, offset: number) {
    const view = new DataView(buffer, offset)
    if (this.isShortForm) {
      view.setUint8(0, this.content.byteLength)

      this.content.write(buffer, offset + 1)
    }
    // For buffers >= 128 bytes, use long-form determinant.
    else {
      // Prefix with byte of 128 + n, where n is the length *of the length* in bytes
      // In ILP, all variable-length fields < 65536 bytes. Therefore,
      // the length-of-length always fits within the u16 range, or 2 bytes
      view.setUint8(0, 128 + 2)
      // Then, write the length in bytes
      view.setUint16(1, this.content.byteLength)

      this.content.write(buffer, offset + 3)
    }
  }
}

class StringEncoder extends Encoder {
  private static textEncoder = new TextEncoder()
  private content: string

  constructor(str: string) {
    super()
    // TODO sanitize so characters are only ASCII!
    this.content = str
  }

  get byteLength() {
    // Since the string is sanitized as ASCII, each character is 1 byte
    return this.content.length
  }

  write(buffer: ArrayBuffer, offset: number) {
    const source = new Uint8Array(buffer, offset)
    StringEncoder.textEncoder.encodeInto(this.content, source)
  }
}

class BufferEncoder extends Encoder {
  private content: Uint8Array

  constructor(content: Uint8Array) {
    super()
    this.content = content
  }

  get byteLength() {
    return this.content.byteLength
  }

  write(buffer: ArrayBuffer, offset: number) {
    // TODO More efficient way to copy between buffers?
    let i = offset
    for (const byte of this.content) {
      buffer[i] = byte
      i++
    }
  }
}

class MultiFieldEncoder extends Encoder {
  private fields: Encoder[]

  constructor(...fields: Encoder[]) {
    super()
    this.fields = fields
  }

  get byteLength() {
    return this.fields.map((encoder) => encoder.byteLength).reduce((a, b) => a + b, 0)
  }

  write(buffer: ArrayBuffer, offset: number) {
    for (const encoder of this.fields) {
      encoder.write(buffer, offset)
      offset += encoder.byteLength
    }
  }
}
