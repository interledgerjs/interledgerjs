import { StreamController, StreamReply, StreamRequestBuilder } from '.'
import { Maybe } from 'true-myth'
import { PaymentState } from '..'
import {
  ConnectionNewAddressFrame,
  ConnectionAssetDetailsFrame,
  FrameType
} from 'ilp-protocol-stream/dist/src/packet'

interface AssetDetails {
  code: string
  scale: number
}

/** Controller for sharing mutual asset and connection details between endpoints */
export class AssetDetailsController implements StreamController {
  private remoteKnowsOurAccount = false
  private sourceAddress: string
  private destinationAsset: Maybe<AssetDetails> = Maybe.nothing()

  constructor(sourceAddress: string, destinationAsset?: AssetDetails) {
    this.sourceAddress = sourceAddress
    this.destinationAsset = Maybe.fromNullable(destinationAsset)
  }

  getDestinationAssetDetails(): Maybe<AssetDetails> {
    return this.destinationAsset
  }

  nextState(builder: StreamRequestBuilder) {
    // Notify the recipient of our source account
    if (!this.remoteKnowsOurAccount) {
      builder.addFrames(new ConnectionNewAddressFrame(this.sourceAddress))
    }

    return PaymentState.SendMoney
  }

  applyFulfill(reply: StreamReply) {
    this.handleDestinationDetails(reply)
  }

  applyReject(reply: StreamReply) {
    this.handleDestinationDetails(reply)
  }

  private handleDestinationDetails({ isAuthentic, responseFrames }: StreamReply) {
    if (isAuthentic) {
      this.remoteKnowsOurAccount = true
    }

    // TODO If the destination asset changes... is should end the payment immediately!

    // Only set destination details if we don't already know them
    if (responseFrames && this.destinationAsset.isNothing()) {
      const assetDetails = responseFrames.find(
        (frame): frame is ConnectionAssetDetailsFrame =>
          frame.type === FrameType.ConnectionAssetDetails
      )
      if (assetDetails) {
        this.destinationAsset = Maybe.just({
          scale: assetDetails.sourceAssetScale,
          code: assetDetails.sourceAssetCode
        })
      }
    }
  }
}
