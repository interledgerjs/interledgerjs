import * as IlpPacket from 'ilp-packet'
import * as Packet from '../../src/packet'

export interface TestPacket {
  sequence: string
  packetType: IlpPacket.Type
  frames: Packet.Frame[]
  amount: string
}

export type TestPacketVariant = Partial<TestPacket> & { name: string }

export interface Fixture {
  name: string
  packet: TestPacket
  buffer: string
  decode_only?: boolean
}
