/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosResponse } from 'axios'
import { NonNegativeNumber, isNonNegativeNumber } from '../utils'

const DAY_DURATION_MS = 24 * 60 * 60 * 1000

/** Rates and trading volume for the 100 top crypto assets */
const COINCAP_ASSETS_URL = 'https://api.coincap.io/v2/assets'

/** Crypto rates, with fiat rates provided by OpenExchangeRates.org */
const COINCAP_RATES_URL = 'https://api.coincap.io/v2/rates'

interface CoinCapResponse {
  timestamp: number
  data: (
    | {
        symbol: string
        rateUsd: string
      }
    | {
        symbol: string
        priceUsd: string
      }
  )[]
}

const isValidResponse = (o: any): o is CoinCapResponse =>
  typeof o === 'object' &&
  o !== null &&
  typeof o.timestamp === 'number' &&
  Array.isArray(o.data) &&
  o.data.every(
    (el: any) =>
      typeof el.symbol === 'string' &&
      (typeof el.priceUsd === 'string' || typeof el.rateUsd === 'string')
  )

const parseResponse = ({
  data,
}: AxiosResponse<any>): {
  [symbol: string]: NonNegativeNumber
} => {
  const minimumUpdatedTimestamp = Date.now() - DAY_DURATION_MS
  if (!isValidResponse(data) || data.timestamp < minimumUpdatedTimestamp) {
    return {}
  }

  return data.data
    .map((pair): [string, number] => [
      pair.symbol,
      'priceUsd' in pair ? +pair.priceUsd : +pair.rateUsd,
    ])
    .filter((pair): pair is [string, NonNegativeNumber] => isNonNegativeNumber(pair[1]))
    .reduce(
      (acc, [symbol, price]) => ({
        ...acc,
        [symbol]: price,
      }),
      {}
    )
}

export const fetchCoinCapRates = async (): Promise<{
  [symbol: string]: NonNegativeNumber
}> => ({
  ...parseResponse(
    await axios.get(COINCAP_ASSETS_URL, {
      timeout: 5000,
    })
  ),
  ...parseResponse(
    await axios.get(COINCAP_RATES_URL, {
      timeout: 5000,
    })
  ),
})
