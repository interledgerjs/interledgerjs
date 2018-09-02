import { BtpSubProtocol } from '.'
const Btp = require('btp-packet')

/**
 * Convert BTP protocol array to a protocol map of all the protocols inside the
 * BTP sub protocol array. Also specifically extract the `ilp` and `custom` protocols
 * from the map.
 */
export function protocolDataToIlpAndCustom (data: { protocolData: Array<BtpSubProtocol> }) {
  const protocolMap = {}
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
    ilp: protocolMap['ilp'],
    custom: protocolMap['custom']
  }
}

/** Convert `ilp` and `custom` protocol data, along with a protocol map, into
 * an array of BTP sub protocols. Order of precedence in the BTP sub protocol
 * array is: `ilp`, any explicitly defined sub protocols (the ones in the
 * protocol map), and finally `custom`.
 */
export function ilpAndCustomToProtocolData (data: { ilp?: Buffer, custom?: Object , protocolMap?: Map<string, Buffer | string | Object> }): Array<BtpSubProtocol> {
  const protocolData = []
  const { ilp, custom, protocolMap } = data

  // ILP is always the primary protocol when it's specified
  if (ilp) {
    protocolData.push({
      protocolName: 'ilp',
      contentType: Btp.MIME_APPLICATION_OCTET_STREAM,
      // TODO JS originally had a Buffer.from(ilp, 'base64')?
      data: ilp
    })
  }

  // explicitly specified sub-protocols come next
  if (protocolMap) {
    const sideProtocols = Object.keys(protocolMap)
    for (const protocol of sideProtocols) {
      if (Buffer.isBuffer(protocolMap[protocol])) {
        protocolData.push({
          protocolName: protocol,
          contentType: Btp.MIME_APPLICATION_OCTET_STREAM,
          data: protocolMap[protocol]
        })
      } else if (typeof protocolMap[protocol] === 'string') {
        protocolData.push({
          protocolName: protocol,
          contentType: Btp.MIME_TEXT_PLAIN_UTF8,
          data: Buffer.from(protocolMap[protocol])
        })
      } else {
        protocolData.push({
          protocolName: protocol,
          contentType: Btp.MIME_APPLICATION_JSON,
          data: Buffer.from(JSON.stringify(protocolMap[protocol]))
        })
      }
    }
  }

  // the "custom" side protocol is always secondary unless its the only sub
  // protocol.
  if (custom) {
    protocolData.push({
      protocolName: 'custom',
      contentType: Btp.MIME_APPLICATION_JSON,
      data: Buffer.from(JSON.stringify(custom))
    })
  }

  return protocolData
}
