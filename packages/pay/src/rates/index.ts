import { Brand, Rational } from 'src/utils'
import BigNumber from 'bignumber.js'

/**
 * Set of asset prices. Mapping of each currency's symbol or code to
 * a price in the same base asset
 */
export interface AssetPrices {
  [assetCode: string]: number
}

/** Function fetch asset prices relative to the same base currency */
export type FetchPrices = () => Promise<AssetPrices>

export type ValidRate = Brand<number, 'ValidRate'>

// TODO isFinite prevents `NaN` `Infinity`, also prevent negative rates
export const isValidRate = (o: number): o is ValidRate => Number.isFinite(o) && o >= 0

/**
 * Compute an exchange rate between the source asset and destination asset:
 * determine the quantity of the destination asset given 1 unit of the source asset.
 * @param sourceAssetCode 3 or 4 character code to identify the source asset
 * @param sourceAssetScale Determines the fractional unit of the source asset: number
 *        of orders of magnitude between the typical unit of value and this fractional unit
 * @param destinationAssetCode 3 or 4 character code to identify the destination asset
 * @param destinationAssetScale Determines the fractional unit of the destination asset: number
 *        of orders of magnitude between the typical unit of value and this fractional unit
 * @param prices Cached asset prices relative to the same base currency
 */
export const getRate = (
  sourceAssetCode: string,
  sourceAssetScale: number,
  destinationAssetCode: string,
  destinationAssetScale: number,
  prices: {
    [assetCode: string]: number
  }
): Rational | undefined => {
  let rate = 1

  // Only fetch the price if the assets are different -- otherwise rate is 1!
  if (sourceAssetCode !== destinationAssetCode) {
    const sourceAssetPrice = prices[sourceAssetCode]
    if (!sourceAssetPrice) {
      return
    }

    const destinationAssetPrice = prices[destinationAssetCode]
    if (!destinationAssetPrice) {
      return
    }

    // This seems counterintuitive because the rate is typically destination amount / source amount
    // However, this is different becaues it's converting source asset -> base currency -> destination asset
    rate = sourceAssetPrice / destinationAssetPrice
  }

  // Since the rate is in the unit of exchange, it must be converted to the correct scaled units
  const scaledRate = rate * 10 ** (destinationAssetScale - sourceAssetScale)

  // If any destination asset price is 0, rate will be Infinity
  if (!isValidRate(scaledRate)) {
    return
  }

  // TODO Add validation when constructing the `Rational` directly
  return new BigNumber(scaledRate) as Rational
}

export const convert = (
  sourceAmount: BigNumber.Value,
  sourceAssetCode: string,
  destinationAssetCode: string,
  destinationAssetScale: number,
  prices: AssetPrices,
  roundingMode: typeof BigNumber.ROUND_DOWN | typeof BigNumber.ROUND_CEIL
): BigNumber | undefined =>
  getRate(sourceAssetCode, 0, destinationAssetCode, destinationAssetScale, prices)
    ?.times(sourceAmount)
    .integerValue(roundingMode)
