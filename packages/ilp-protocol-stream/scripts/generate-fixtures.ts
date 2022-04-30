import Long from 'long'
import * as IlpPacket from 'ilp-packet'
import * as Packet from '../src/packet'

const NUMBERS = [
  { name: '0', value: Long.UZERO },
  { name: 'max_js', value: Long.fromNumber(Number.MAX_SAFE_INTEGER, true) },
  { name: 'max_uint_64', value: Long.MAX_UNSIGNED_VALUE },
]

Long.prototype['toJSON'] = function () {
  return this.toString()
}

Packet.StreamDataFrame.prototype.toJSON = function () {
  return {
    type: this.type,
    name: this.name,
    streamId: this.streamId,
    offset: this.offset,
    data: this.data.toString('base64'),
  }
}

interface TestPacket {
  sequence: string
  packetType: IlpPacket.Type
  frames: Packet.Frame[]
  amount: string
}

type TestPacketVariant = Partial<TestPacket> & { name: string }

interface Fixture {
  name: string
  packet: TestPacket
  buffer: string
  decode_only?: boolean
}

const variants: TestPacketVariant[] = [
  ...NUMBERS.map((pair) => ({ name: 'sequence:' + pair.name, sequence: pair.value.toString() })),
  { name: 'type:prepare', packetType: Packet.IlpPacketType.Prepare },
  { name: 'type:fulfill', packetType: Packet.IlpPacketType.Fulfill },
  { name: 'type:reject', packetType: Packet.IlpPacketType.Reject },
  ...NUMBERS.map((pair) => ({ name: 'amount:' + pair.name, amount: pair.value.toString() })),

  {
    name: 'frame:connection_close',
    frames: [new Packet.ConnectionCloseFrame(0x01, 'fail')],
  },
  {
    name: 'frame:connection_new_address',
    frames: [new Packet.ConnectionNewAddressFrame('example.alice')],
  },
  {
    name: 'frame:connection_asset_details',
    frames: [new Packet.ConnectionAssetDetailsFrame('ABC', 256 - 1)],
  },

  ...NUMBERS.map((pair) => ({
    name: 'frame:connection_max_data:' + pair.name,
    frames: [new Packet.ConnectionMaxDataFrame(pair.value)],
  })),
  ...NUMBERS.map((pair) => ({
    name: 'frame:connection_data_blocked:' + pair.name,
    frames: [new Packet.ConnectionDataBlockedFrame(pair.value)],
  })),
  ...NUMBERS.map((pair) => ({
    name: 'frame:connection_max_stream_id:' + pair.name,
    frames: [new Packet.ConnectionMaxStreamIdFrame(pair.value)],
  })),
  ...NUMBERS.map((pair) => ({
    name: 'frame:connection_stream_id_blocked:' + pair.name,
    frames: [new Packet.ConnectionStreamIdBlockedFrame(pair.value)],
  })),

  {
    name: 'frame:stream_close',
    frames: [new Packet.StreamCloseFrame(123, 256 - 1, 'an error message')],
  },

  ...NUMBERS.map((pair) => ({
    name: 'frame:stream_money:' + pair.name,
    frames: [new Packet.StreamMoneyFrame(123, pair.value)],
  })),
  ...NUMBERS.map((pair) => ({
    name: 'frame:stream_max_money:receive_max:' + pair.name,
    frames: [new Packet.StreamMaxMoneyFrame(123, pair.value, 456)],
  })),
  ...NUMBERS.map((pair) => ({
    name: 'frame:stream_max_money:total_received:' + pair.name,
    frames: [new Packet.StreamMaxMoneyFrame(123, 456, pair.value)],
  })),
  ...NUMBERS.map((pair) => ({
    name: 'frame:stream_money_blocked:send_max:' + pair.name,
    frames: [new Packet.StreamMoneyBlockedFrame(123, pair.value, 456)],
  })),
  ...NUMBERS.map((pair) => ({
    name: 'frame:stream_money_blocked:total_sent:' + pair.name,
    frames: [new Packet.StreamMoneyBlockedFrame(123, 456, pair.value)],
  })),

  {
    name: 'frame:stream_data',
    frames: [new Packet.StreamDataFrame(123, 456, Buffer.from('foobar'))],
  },
  ...NUMBERS.map((pair) => ({
    name: 'frame:stream_data:offset:' + pair.name,
    frames: [new Packet.StreamDataFrame(123, pair.value, Buffer.alloc(0))],
  })),
  ...NUMBERS.map((pair) => ({
    name: 'frame:stream_max_data:offset:' + pair.name,
    frames: [new Packet.StreamMaxDataFrame(123, pair.value)],
  })),
  ...NUMBERS.map((pair) => ({
    name: 'frame:stream_data_blocked:offset:' + pair.name,
    frames: [new Packet.StreamDataBlockedFrame(123, pair.value)],
  })),
  {
    name: 'frame:stream_receipt',
    frames: [
      new Packet.StreamReceiptFrame(
        1,
        Buffer.from(
          'AQAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAfTBIvoCUt67Zy1ZGCP3EOmVFtZzhc85fah8yPnoyL9RMA==',
          'base64'
        )
      ),
    ],
  },
]

const fixtures: Fixture[] = variants.map(function (params) {
  const packetOptions: TestPacket = {
    sequence: params.sequence ?? '0',
    packetType: params.packetType ?? Packet.IlpPacketType.Prepare,
    amount: params.amount ?? '0',
    frames: params.frames ?? [],
  }

  const packet = new Packet.Packet(
    packetOptions.sequence,
    packetOptions.packetType,
    packetOptions.amount,
    packetOptions.frames
  )

  return {
    name: params.name,
    packet: packetOptions,
    buffer: packet._serialize().toString('base64'),
  }
})

// The receive_max is set to `Long.MAX_UNSIGNED_VALUE + 1`.
fixtures.push({
  name: 'frame:stream_max_money:receive_max:too_big',
  packet: {
    sequence: '0',
    packetType: Packet.IlpPacketType.Prepare,
    amount: '0',
    frames: [new Packet.StreamMaxMoneyFrame(123, Long.MAX_UNSIGNED_VALUE, 456)],
  },
  buffer: 'AQwBAAEAAQESDwF7CQEAAAAAAAAAAAIByA==',
  decode_only: true,
})

// The send_max is set to `Long.MAX_UNSIGNED_VALUE + 1`.
fixtures.push({
  name: 'frame:stream_money_blocked:send_max:too_big',
  packet: {
    sequence: '0',
    packetType: Packet.IlpPacketType.Prepare,
    amount: '0',
    frames: [new Packet.StreamMoneyBlockedFrame(123, Long.MAX_UNSIGNED_VALUE, 456)],
  },
  buffer: 'AQwBAAEAAQETDwF7CQEAAAAAAAAAAAIByA==',
  decode_only: true,
})

const fixturesObject = {}

fixtures.forEach(({ name, ...fixture }) => (fixturesObject[name] = fixture))

console.log(JSON.stringify(fixturesObject, null, '  '))
