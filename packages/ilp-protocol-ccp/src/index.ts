import * as IlpPacket from 'ilp-packet'
import { Reader, Writer } from 'oer-utils'
import { readUuid, writeUuid } from './uuid'

export const CCP_CONTROL_DESTINATION = 'peer.route.control'
export const CCP_UPDATE_DESTINATION = 'peer.route.update'
export const PEER_PROTOCOL_FULFILLMENT = Buffer.alloc(32)
export const PEER_PROTOCOL_CONDITION = Buffer.from('Zmh6rfhivXdsj8GLjp+OIAiXFIVu4jOzkCpZHQ1fKSU=', 'base64')
const PEER_PROTOCOL_EXPIRY_DURATION = 60000

export enum Mode {
  MODE_IDLE = 0,
  MODE_SYNC = 1
}

export const ModeReverseMap = ['IDLE', 'SYNC']

export interface CcpRouteControlRequest {
  mode: Mode.MODE_IDLE | Mode.MODE_SYNC
  lastKnownRoutingTableId: string
  lastKnownEpoch: number
  features: string[]
}

export interface CcpRouteControlResponse {
  // empty
}

// Well-known route property IDs
export enum PropId {
}

export interface CcpRoutePropCommon {
  isOptional: boolean
  isTransitive: boolean
  isPartial: boolean
}

export interface CcpRoutePropBuffer extends CcpRoutePropCommon {
  isUtf8: false
  id: number
  value: Buffer
}

export interface CcpRoutePropString extends CcpRoutePropCommon {
  isUtf8: true
  id: number
  value: string
}

export type CcpRouteProp =
  // Generic props
  CcpRoutePropBuffer |
  CcpRoutePropString

export interface CcpRoute {
  prefix: string
  path: string[]
  auth: Buffer
  props: CcpRouteProp[]
}

export interface CcpRouteUpdateRequest {
  routingTableId: string
  currentEpochIndex: number
  fromEpochIndex: number
  toEpochIndex: number
  holdDownTime: number
  speaker: string
  newRoutes: CcpRoute[]
  withdrawnRoutes: string[]
}

export interface CcpRouteUpdateResponse {
  // empty
}

const deserializeCcpRouteControlRequest = (request: Buffer): CcpRouteControlRequest => {
  const ilp = IlpPacket.deserializeIlpPrepare(request)

  if (ilp.destination !== CCP_CONTROL_DESTINATION) {
    throw new TypeError('packet is not a CCP route control request.')
  }

  if (!PEER_PROTOCOL_CONDITION.equals(ilp.executionCondition)) {
    throw new Error('packet does not contain correct condition for a peer protocol request.')
  }

  if (Date.now() > Number(ilp.expiresAt)) {
    throw new Error('CCP route control request packet is expired.')
  }

  const reader = new Reader(ilp.data)

  const mode = reader.readUInt8Number()

  const lastKnownRoutingTableId = readUuid(reader)

  const lastKnownEpoch = reader.readUInt32Number()

  const featureCount = reader.readVarUIntNumber()
  const features = []
  for (let i = 0; i < featureCount; i++) {
    features.push(reader.readVarOctetString().toString('utf8'))
  }

  return {
    mode,
    lastKnownRoutingTableId,
    lastKnownEpoch,
    features
  }
}

const serializeCcpRouteControlRequest = (request: CcpRouteControlRequest): Buffer => {
  const writer = new Writer()

  writer.writeUInt8(request.mode)

  writeUuid(writer, request.lastKnownRoutingTableId)

  writer.writeUInt32(request.lastKnownEpoch)

  writer.writeVarUInt(request.features.length)

  for (const feature of request.features) {
    writer.writeVarOctetString(Buffer.from(feature, 'utf8'))
  }

  return IlpPacket.serializeIlpPrepare({
    amount: '0',
    destination: CCP_CONTROL_DESTINATION,
    executionCondition: PEER_PROTOCOL_CONDITION,
    expiresAt: new Date(Date.now() + PEER_PROTOCOL_EXPIRY_DURATION),
    data: writer.getBuffer()
  })
}

const deserializeCcpRouteUpdateRequest = (request: Buffer): CcpRouteUpdateRequest => {
  const ilp = IlpPacket.deserializeIlpPrepare(request)

  if (ilp.destination !== CCP_UPDATE_DESTINATION) {
    throw new TypeError('packet is not a CCP route update request.')
  }

  if (!PEER_PROTOCOL_CONDITION.equals(ilp.executionCondition)) {
    throw new Error('packet does not contain correct condition for a peer protocol request.')
  }

  if (Date.now() > Number(ilp.expiresAt)) {
    throw new Error('CCP route update request packet is expired.')
  }

  const reader = new Reader(ilp.data)

  const routingTableId = readUuid(reader)

  const currentEpochIndex = reader.readUInt32Number()

  const fromEpochIndex = reader.readUInt32Number()

  const toEpochIndex = reader.readUInt32Number()

  const holdDownTime = reader.readUInt32Number()

  const speaker = reader.readVarOctetString().toString('ascii')

  const newRoutesCount = reader.readVarUIntNumber()
  const newRoutes = []
  for (let i = 0; i < newRoutesCount; i++) {
    const prefix = reader.readVarOctetString().toString('ascii')

    const pathLength = reader.readVarUIntNumber()
    const path = []
    for (let i = 0; i < pathLength; i++) {
      path.push(reader.readVarOctetString().toString('ascii'))
    }

    const auth = reader.read(32)

    const propCount = reader.readVarUIntNumber()
    const props: CcpRouteProp[] = []
    for (let i = 0; i < propCount; i++) {
      const meta = reader.readUInt8Number()
      const isOptional = Boolean(meta & 0x80)
      const isTransitive = Boolean(meta & 0x40)
      const isPartial = Boolean(meta & 0x20)
      const isUtf8 = Boolean(meta & 0x10)

      const id = reader.readUInt16Number()
      const value = reader.readVarOctetString()

      const incompleteProp = {
        isOptional,
        isTransitive,
        isPartial,
        id
      }

      if (isUtf8) {
        props.push({
          ...incompleteProp,
          isUtf8: true,
          value: value.toString('utf8')
        })
      } else {
        props.push({
          ...incompleteProp,
          isUtf8: false,
          value: value
        })
      }
    }

    newRoutes.push({
      prefix,
      path,
      auth,
      props
    })
  }

  const withdrawnRoutesCount = reader.readVarUIntNumber()
  const withdrawnRoutes = []
  for (let i = 0; i < withdrawnRoutesCount; i++) {
    withdrawnRoutes.push(reader.readVarOctetString().toString('utf8'))
  }

  return {
    routingTableId,
    currentEpochIndex,
    fromEpochIndex,
    toEpochIndex,
    holdDownTime,
    speaker,
    newRoutes,
    withdrawnRoutes
  }
}

const serializeCcpRouteUpdateRequest = (request: CcpRouteUpdateRequest): Buffer => {
  const writer = new Writer()

  writeUuid(writer, request.routingTableId)

  writer.writeUInt32(request.currentEpochIndex)
  writer.writeUInt32(request.fromEpochIndex)
  writer.writeUInt32(request.toEpochIndex)

  writer.writeUInt32(request.holdDownTime)

  writer.writeVarOctetString(Buffer.from(request.speaker, 'ascii'))

  writer.writeVarUInt(request.newRoutes.length)
  for (const route of request.newRoutes) {
    writer.writeVarOctetString(Buffer.from(route.prefix, 'ascii'))

    writer.writeVarUInt(route.path.length)
    for (const hop of route.path) {
      writer.writeVarOctetString(Buffer.from(hop, 'ascii'))
    }

    if (route.auth.length !== 32) {
      throw new Error('route auth must be 32 bytes. prefix=' + route.prefix)
    }
    writer.write(route.auth)

    writer.writeVarUInt(route.props.length)
    for (const prop of route.props) {
      let meta = 0

      meta |= prop.isOptional ? 0x80 : 0

      if (prop.isOptional) {
        meta |= prop.isTransitive ? 0x40 : 0

        if (prop.isTransitive) {
          meta |= prop.isPartial ? 0x20 : 0
        }
      } else {
        // Transitive bit must be set for well-known properties
        meta |= 0x40
      }

      meta |= prop.isUtf8 ? 0x10 : 0

      writer.writeUInt8(meta)

      writer.writeUInt16(prop.id)

      writer.writeVarOctetString(prop.isUtf8 ? Buffer.from(prop.value, 'utf8') : prop.value)
    }
  }

  writer.writeVarUInt(request.withdrawnRoutes.length)
  for (const route of request.withdrawnRoutes) {
    writer.writeVarOctetString(Buffer.from(route, 'ascii'))
  }

  return IlpPacket.serializeIlpPrepare({
    amount: '0',
    destination: CCP_UPDATE_DESTINATION,
    executionCondition: PEER_PROTOCOL_CONDITION,
    expiresAt: new Date(Date.now() + PEER_PROTOCOL_EXPIRY_DURATION),
    data: writer.getBuffer()
  })
}

const deserializeCcpResponse = (response: Buffer): void => {
  const { fulfillment } = IlpPacket.deserializeIlpFulfill(response)

  if (!PEER_PROTOCOL_FULFILLMENT.equals(fulfillment)) {
    throw new Error('CCP response does not contain the expected fulfillment.')
  }
}

const serializeCcpResponse = (): Buffer => {
  return IlpPacket.serializeIlpFulfill({
    fulfillment: PEER_PROTOCOL_FULFILLMENT,
    data: Buffer.alloc(0)
  })
}

export {
  deserializeCcpRouteControlRequest,
  serializeCcpRouteControlRequest,
  deserializeCcpRouteUpdateRequest,
  serializeCcpRouteUpdateRequest,
  deserializeCcpResponse,
  serializeCcpResponse
}
