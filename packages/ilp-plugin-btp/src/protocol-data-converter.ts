import { BtpSubProtocol } from '.'
import * as Btp from 'btp-packet'

export type ObjectType = Record<string, unknown>
export type ProtocolMapType = Record<string, Buffer | string | ObjectType>

export interface Protocols {
  ilp?: Buffer
  custom?: ObjectType
  protocolMap?: ProtocolMapType
}

/**
 * Convert BTP protocol array to a protocol map of all the protocols inside the
 * BTP sub protocol array. Also, specifically extract the `ilp` and `custom` protocols
 * from the map.
 */
export function protocolDataToIlpAndCustom(data: {
  protocolData: Array<BtpSubProtocol>
}): Protocols {
  const protocolMap: ProtocolMapType = {}
  const { protocolData } = data

  for (const protocol of protocolData) {
    const name = protocol.protocolName

    if (protocol.contentType === Btp.MIME_TEXT_PLAIN_UTF8) {
      protocolMap[name] = protocol.data.toString('utf8')
    } else if (protocol.contentType === Btp.MIME_APPLICATION_JSON) {
      protocolMap[name] = JSON.parse(protocol.data.toString('utf8'))
    } else {
      protocolMap[name] = protocol.data
    }
  }

  return {
    protocolMap,
    ilp: protocolMap['ilp'] as Buffer,
    custom: protocolMap['custom'] as ObjectType,
  }
}

/** Convert `ilp` and `custom` protocol data, along with a protocol map, into
 * an array of BTP sub protocols. Order of precedence in the BTP sub protocol
 * array is: `ilp`, any explicitly defined sub protocols (the ones in the
 * protocol map), and finally `custom`.
 */
export function ilpAndCustomToProtocolData(data: Protocols): Array<BtpSubProtocol> {
  const protocolData = []
  const { ilp, custom, protocolMap } = data

  // ILP is always the primary protocol when it's specified
  if (ilp) {
    protocolData.push({
      protocolName: 'ilp',
      contentType: Btp.MIME_APPLICATION_OCTET_STREAM,
      // TODO JS originally had a Buffer.from(ilp, 'base64')?
      data: ilp,
    })
  }

  // explicitly specified sub-protocols come next
  if (protocolMap) {
    for (const protocolName in protocolMap) {
      const data = protocolMap[protocolName]
      if (Buffer.isBuffer(data)) {
        protocolData.push({
          protocolName,
          contentType: Btp.MIME_APPLICATION_OCTET_STREAM,
          data,
        })
      } else if (typeof data === 'string') {
        protocolData.push({
          protocolName,
          contentType: Btp.MIME_TEXT_PLAIN_UTF8,
          data: Buffer.from(data),
        })
      } else {
        protocolData.push({
          protocolName,
          contentType: Btp.MIME_APPLICATION_JSON,
          data: Buffer.from(JSON.stringify(data)),
        })
      }
    }
  }

  // the "custom" side protocol is always secondary unless it's the only sub
  // protocol.
  if (custom) {
    protocolData.push({
      protocolName: 'custom',
      contentType: Btp.MIME_APPLICATION_JSON,
      data: Buffer.from(JSON.stringify(custom)),
    })
  }

  return protocolData
}
