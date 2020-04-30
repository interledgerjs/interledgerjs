/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios'
import {
  IlpAddress,
  isValidIlpAddress,
  isSharedSecretBase64,
  parsePaymentPointer,
  isSharedSecretBuffer
} from './shared'
import { PaymentError } from '..'

export interface StreamCredentials {
  destinationAddress: IlpAddress
  sharedSecret: Buffer
}

export const isStreamCredentials = (o: any): o is StreamCredentials =>
  typeof o === 'object' &&
  o !== null &&
  isValidIlpAddress(o.destinationAddress) &&
  isSharedSecretBuffer(o.sharedSecret)

export interface SpspResponse {
  destination_account: IlpAddress
  shared_secret: string
}

const isValidSpspResponse = (o: any): o is SpspResponse =>
  typeof o === 'object' &&
  o !== null &&
  isValidIlpAddress(o.destination_account) &&
  isSharedSecretBase64(o.shared_secret)

export const query = async (paymentPointer: string): Promise<StreamCredentials> => {
  const spspUrl = parsePaymentPointer(paymentPointer, true)
  if (!spspUrl) {
    throw PaymentError.InvalidPaymentPointer
  }

  return axios
    .get(spspUrl, {
      headers: {
        Accept: 'application/spsp4+json'
      }
    })
    .catch(() => {
      throw PaymentError.SpspQueryFailed
    })
    .then(({ data }) => {
      if (isValidSpspResponse(data)) {
        return {
          destinationAddress: data.destination_account,
          sharedSecret: Buffer.from(data.shared_secret, 'base64')
        }
      } else {
        throw PaymentError.SpspQueryFailed
      }
    })
}
