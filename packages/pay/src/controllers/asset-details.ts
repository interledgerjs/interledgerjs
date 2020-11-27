import { ConnectionAssetDetailsFrame, FrameType } from 'ilp-protocol-stream/dist/src/packet'
import { StreamController } from '.'
import { PaymentError } from '..'
import { StreamReply } from '../request'

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
export const isValidAssetDetails = (o: any): o is AssetDetails =>
  typeof o === 'object' &&
  o !== null &&
  typeof o.assetCode === 'string' &&
  isValidAssetScale(o.assetScale)

export const isValidAssetScale = (o: unknown): o is number =>
  typeof o === 'number' && o >= 0 && o <= 255 && Number.isInteger(o)

/** Asset information for an Interledger account */
export interface AssetDetails {
  /** Precision of the asset denomination: number of decimal places of the normal unit */
  assetScale: number
  /** Asset code or symbol identifying the currency of the account */
  assetCode: string
}

/**
 * Track destination asset details from the STREAM receiver and
 * check for conflicts with existing asset details
 */
export class AssetDetailsController implements StreamController {
  constructor(private destinationAsset?: AssetDetails) {}

  getDestinationAsset(): AssetDetails | undefined {
    return this.destinationAsset
  }

  applyRequest(): (reply: StreamReply) => PaymentError | void {
    return ({ frames, log }: StreamReply) => {
      const newAssetDetails = (frames ?? [])
        .filter(
          (frame): frame is ConnectionAssetDetailsFrame =>
            frame.type === FrameType.ConnectionAssetDetails
        )
        .map(
          (frame): AssetDetails => ({
            assetCode: frame.sourceAssetCode,
            assetScale: frame.sourceAssetScale,
          })
        )

      for (const { assetCode, assetScale } of newAssetDetails) {
        // Only set destination details if we don't already know them
        if (!this.destinationAsset) {
          log.debug('got destination asset details: %s %s', assetCode, assetScale)
          // Packet deserialization should already ensure the asset scale is limited to u8:
          // https://github.com/interledgerjs/ilp-protocol-stream/blob/8551fd498f1ff313da72f63891b9fa428212c31a/src/packet.ts#L274
          this.destinationAsset = {
            assetCode,
            assetScale,
          }
        }
        // If the destination asset details changed, end the payment
        else if (
          this.destinationAsset.assetCode !== assetCode ||
          this.destinationAsset.assetScale !== assetScale
        ) {
          log.error(
            'ending payment: remote unexpectedly changed destination asset from %s %s to %s %s',
            this.destinationAsset.assetCode,
            this.destinationAsset.assetScale,
            assetCode,
            assetScale
          )
          return PaymentError.DestinationAssetConflict
        }
      }
    }
  }
}
