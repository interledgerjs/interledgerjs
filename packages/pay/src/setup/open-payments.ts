/* eslint-disable @typescript-eslint/no-explicit-any */
import BigNumber from 'bignumber.js'
import { IlpAddress, isValidIlpAddress, isSharedSecretBase64 } from './shared'
import { Brand } from '../utils'

const MAX_U64 = new BigNumber('18446744073709551615')

const isValidU64 = (o: BigNumber.Value): boolean => {
  const bn = new BigNumber(o)
  return (
    bn.isFinite() &&
    bn.isGreaterThanOrEqualTo(0) &&
    bn.isLessThanOrEqualTo(MAX_U64) &&
    bn.isInteger()
  )
}

export type AssetScale = Brand<number, 'AssetScale'>
export const isValidAssetScale = (o: any): o is AssetScale =>
  typeof o === 'number' && o >= 0 && o <= 255 && Number.isInteger(o)

const isValidIsoDate = (o: string): boolean => !Number.isNaN(Date.parse(o))

interface OpenPaymentsInvoiceDetails {
  subject: string
  amount: string
  assetCode: string
  assetScale: number
  received: string
  expiresAt: string
  description: string
}

const isValidOpenPaymentsInvoiceDetails = (o: any): o is OpenPaymentsInvoiceDetails =>
  typeof o === 'object' &&
  o !== null &&
  typeof o.subject === 'string' &&
  // TODO Validate subject is URL without protocol?
  typeof o.amount === 'string' &&
  isValidU64(o.amount) &&
  typeof o.assetCode === 'string' &&
  typeof o.assetScale === 'number' &&
  isValidAssetScale(o.assetScale) &&
  typeof o.received === 'string' &&
  isValidU64(o.received) &&
  typeof o.expiresAt === 'string' &&
  isValidIsoDate(o.expiresAt) &&
  typeof o.description === 'string' // TODO Should this be optional?

interface OpenPaymentsInvoiceCredentials {
  ilpAddress: IlpAddress
  sharedSecret: string
}

const isValidOpenPaymentsInvoiceCredentials = (o: any): o is OpenPaymentsInvoiceCredentials =>
  typeof o === 'object' &&
  o !== null &&
  typeof o.ilpAddress === 'string' &&
  isValidIlpAddress(o.ilpAddress) &&
  typeof o.sharedSecret === 'string' &&
  isSharedSecretBase64(o.sharedSecret)

const isValidHttpsUrl = (o: string) => {
  try {
    const url = new URL(o)
    return url.protocol === 'https:'
  } catch (_) {
    return false
  }
}

const isValidOpenPaymentsMetadata = (o: any): o is OpenPaymentsMetadata =>
  typeof o === 'object' &&
  o !== null &&
  typeof o.issuer === 'string' &&
  isValidHttpsUrl(o.issuer) &&
  typeof o.invoices_endpoint === 'string' &&
  isValidHttpsUrl(o.invoices_endpoint)

interface OpenPaymentsMetadata {
  issuer: string
  invoices_endpoint: string
}
