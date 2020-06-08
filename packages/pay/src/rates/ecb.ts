/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios'
import parseXml, { NodeBase, Element, Document } from '@rgrove/parse-xml'

const DAY_DURATION_MS = 24 * 60 * 60 * 1000

const isElement = (node: NodeBase): node is Element => node.type === 'element'
const isDocument = (node: NodeBase): node is Document => node.type === 'document'

const hasCurrencyPair = (el: Element): boolean => !!el.attributes.currency && !!el.attributes.rate

const minimumUpdatedTimestamp = Date.now() - 2 * DAY_DURATION_MS
const isValidTimestamp = (node: NodeBase): boolean =>
  (isElement(node) &&
    !!node.attributes.time &&
    new Date(node.attributes.time).getTime() > minimumUpdatedTimestamp) ||
  ((isElement(node) || isDocument(node)) && node.children.map(isValidTimestamp).some((a) => a))

const parsePairs = (
  node: NodeBase
): {
  [symbol: string]: number
} => {
  if (isElement(node) && hasCurrencyPair(node)) {
    return {
      // [node.attributes.currency]: node.attributes.rate // TODO Fix this so the backend actually fetches rates...
    }
  } else if (isElement(node) || isDocument(node)) {
    return Object.assign({}, ...node.children.map(parsePairs))
  } else {
    return {}
  }
}

export const fetchEcbRates = async (): Promise<{
  [symbol: string]: number
}> => {
  const response = await axios.get('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml')
  const parsedResponse = parseXml(response.data)

  // Require the most recent update to be within the past 2 days
  if (!isValidTimestamp(parsedResponse)) {
    throw new Error('Invalid timestamp')
  }

  return parsePairs(parsedResponse)
}
