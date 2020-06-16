import * as IlpPacket from 'ilp-packet'
import { Predictor, Reader, Writer, WriterInterface } from 'oer-utils'
import debug = require('debug')

const log = debug('ilp-protocol-ildcp')

const ILDCP_DESTINATION = 'peer.config'
const PEER_PROTOCOL_FULFILLMENT = Buffer.alloc(32)
const PEER_PROTOCOL_CONDITION = Buffer.from(
  'Zmh6rfhivXdsj8GLjp+OIAiXFIVu4jOzkCpZHQ1fKSU=',
  'base64'
)
const PEER_PROTOCOL_EXPIRY_DURATION = 60000

export interface IldcpRequest {
  expiresAt?: Date
  data?: Buffer
}

export interface IldcpResponse {
  clientAddress: string
  assetScale: number
  assetCode: string
}

const deserializeIldcpRequest = (request: Buffer): IldcpRequest => {
  const ilp = IlpPacket.deserializeIlpPrepare(request)

  if (ilp.destination !== ILDCP_DESTINATION) {
    throw new TypeError('packet is not an IL-DCP request.')
  }

  if (!PEER_PROTOCOL_CONDITION.equals(ilp.executionCondition)) {
    throw new Error('packet does not contain correct condition for a peer protocol request.')
  }

  if (Date.now() > Number(ilp.expiresAt)) {
    throw new Error('IL-DCP request packet is expired.')
  }

  return {
    expiresAt: ilp.expiresAt,
    data: ilp.data,
  }
}

const serializeIldcpRequest = (request: IldcpRequest): Buffer => {
  return IlpPacket.serializeIlpPrepare({
    amount: '0',
    destination: ILDCP_DESTINATION,
    executionCondition: PEER_PROTOCOL_CONDITION,
    expiresAt: request.expiresAt || new Date(Date.now() + PEER_PROTOCOL_EXPIRY_DURATION),
    data: request.data || Buffer.alloc(0),
  })
}

const deserializeIldcpResponse = (response: Buffer): IldcpResponse => {
  const { fulfillment, data } = IlpPacket.deserializeIlpFulfill(response)

  if (!PEER_PROTOCOL_FULFILLMENT.equals(fulfillment)) {
    throw new Error('IL-DCP response does not contain the expected fulfillment.')
  }

  const reader = Reader.from(data)

  const clientAddress = reader.readVarOctetString().toString('ascii')

  const assetScale = reader.readUInt8Number()
  const assetCode = reader.readVarOctetString().toString('utf8')

  return { clientAddress, assetScale, assetCode }
}

const writeIldcpResponse = (
  writer: WriterInterface,
  clientAddress: Buffer,
  assetScale: number,
  assetCode: Buffer
): void => {
  writer.writeVarOctetString(clientAddress)
  writer.writeUInt8(assetScale)
  writer.writeVarOctetString(assetCode)
}

const serializeIldcpResponse = (response: IldcpResponse): Buffer => {
  const clientAddress = Buffer.from(response.clientAddress, 'ascii')
  const assetCode = Buffer.from(response.assetCode, 'utf8')

  const predictor = new Predictor()
  writeIldcpResponse(predictor, clientAddress, response.assetScale, assetCode)

  const writer = new Writer(predictor.length)
  writeIldcpResponse(writer, clientAddress, response.assetScale, assetCode)

  return IlpPacket.serializeIlpFulfill({
    fulfillment: PEER_PROTOCOL_FULFILLMENT,
    data: writer.getBuffer(),
  })
}

const fetch = async (
  sendData: (data: Buffer) => Promise<Buffer>,
  request?: IldcpRequest
): Promise<IldcpResponse> => {
  const data = await sendData(serializeIldcpRequest(request || {}))

  if (data[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
    const { triggeredBy, message } = IlpPacket.deserializeIlpReject(data)
    log('IL-DCP request rejected. triggeredBy=%s errorMessage=%s', triggeredBy, message)
    throw new Error('IL-DCP failed: ' + message)
  } else if (data[0] !== IlpPacket.Type.TYPE_ILP_FULFILL) {
    log('invalid response type. type=%s', data[0])
    throw new Error('IL-DCP error, unable to retrieve client configuration.')
  }

  const { clientAddress, assetScale, assetCode } = deserializeIldcpResponse(data)

  log(
    'received client info. clientAddress=%s assetScale=%s assetCode=%s',
    clientAddress,
    assetScale,
    assetCode
  )

  return { clientAddress, assetScale, assetCode }
}

export interface ServeSettings {
  requestPacket: Buffer
  handler: (request: IldcpRequest) => Promise<IldcpResponse>
  serverAddress: string
}

const serve = async ({ requestPacket, handler, serverAddress }: ServeSettings): Promise<Buffer> => {
  try {
    // Parse the request packet just to make sure it's valid
    deserializeIldcpRequest(requestPacket)

    // In the future, the request packet may contain some parameters. We will pass
    // these to the handler as an object, the handler will then return the
    // response as a JavaScript object.
    const info = await handler({})

    return serializeIldcpResponse(info)
  } catch (err) {
    const errInfo = err && typeof err === 'object' && err.stack ? err.stack : err
    log('error while handling ildcp request. error=%s', errInfo)

    return IlpPacket.serializeIlpReject({
      code: 'F00',
      message: err && typeof err === 'object' && err.message ? err.message : 'unexpected error.',
      triggeredBy: serverAddress,
      data: Buffer.alloc(0),
    })
  }
}

export {
  deserializeIldcpRequest,
  serializeIldcpRequest,
  deserializeIldcpResponse,
  serializeIldcpResponse,
  fetch,
  serve,
}
