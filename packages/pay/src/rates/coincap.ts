/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosResponse } from 'axios'
import { FetchPrices, AssetPrices, isValidRate, ValidRate } from '.'

const DAY_DURATION_MS = 24 * 60 * 60 * 1000

/** Rates and trading volume for the 100 top crypto assets */
const COINCAP_ASSETS_URL = 'https://api.coincap.io/v2/assets'

/** Crypto rates, with fiat rates provided by OpenExchangeRates.org */
const COINCAP_RATES_URL = 'https://api.coincap.io/v2/rates'

interface CoinCapResponse {
  timestamp: number
  data: {
    symbol: string
    rateUsd?: string
    priceUsd?: string
  }[]
}

// TODO Could I use purify schemas feature instead?
const isValidResponse = (o: any): o is CoinCapResponse =>
  typeof o === 'object' &&
  o !== null &&
  typeof o.timestamp === 'number' &&
  Array.isArray(o.data) &&
  o.data.every(
    (el: any) =>
      typeof el.symbol === 'string' &&
      ['string', 'undefined'].includes(typeof el.priceUsd) &&
      ['string', 'undefined'].includes(typeof el.rateUsd)
  )

const parseResponse = ({ data }: AxiosResponse<any>): AssetPrices => {
  const minimumUpdatedTimestamp = Date.now() - DAY_DURATION_MS
  if (!isValidResponse(data) || data.timestamp < minimumUpdatedTimestamp) {
    return {}
  }

  return data.data
    .map((pair): [string, number] => [pair.symbol, +(pair.priceUsd || pair.rateUsd || NaN)])
    .filter((pair): pair is [string, ValidRate] => isValidRate(pair[1]))
    .map(([symbol, price]) => ({
      [symbol]: price,
    }))
    .reduce((acc, cur) => ({ ...acc, ...cur }))
}

export const fetchCoinCapRates: FetchPrices = async () => ({
  ...parseResponse(await axios.get(COINCAP_ASSETS_URL)),
  ...parseResponse(await axios.get(COINCAP_RATES_URL)),
})
