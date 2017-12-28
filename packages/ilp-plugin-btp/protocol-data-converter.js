'use strict'

const Btp = require('btp-packet')
const base64url = require('base64url')

function protocolDataToIlpAndCustom ({ protocolData }) {
  const protocolMap = {}

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
    ilp: protocolMap.ilp,
    custom: protocolMap.custom
  }
}

function ilpAndCustomToProtocolData ({ ilp, custom, protocolMap }) {
  const protocolData = []

  // ILP is always the primary protocol when it's specified
  if (ilp) {
    protocolData.push({
      protocolName: 'ilp',
      contentType: Btp.MIME_APPLICATION_OCTET_STREAM,
      data: Buffer.from(ilp, 'base64')
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

module.exports = {
  protocolDataToIlpAndCustom,
  ilpAndCustomToProtocolData
}
