import { StreamController, StreamReply, StreamRequestBuilder, SendState, isAuthentic } from '.'
import {
  ConnectionNewAddressFrame,
  ConnectionAssetDetailsFrame,
  FrameType,
  StreamMaxMoneyFrame,
  ConnectionMaxDataFrame,
  ConnectionMaxStreamIdFrame
} from 'ilp-protocol-stream/dist/src/packet'
import { DEFAULT_STREAM_ID } from './amount'
import { AssetScale, isValidAssetScale } from '../setup/open-payments'
import { IlpAddress } from '../setup/shared'
import { PaymentError } from '..'

export interface AccountDetails {
  assetCode: string
  assetScale: AssetScale
  ilpAddress: IlpAddress
}

interface AssetDetails {
  assetCode: string
  assetScale: AssetScale
}

/** Controller for sharing source/destination account details */
export class AccountController implements StreamController {
  private remoteKnowsOurAccount = false
  private sourceAccount: AccountDetails

  private destinationAddress: IlpAddress
  private destinationAsset?: AssetDetails

  private remoteAssetChanged = false

  constructor(sourceAccount: AccountDetails, destinationAddress: IlpAddress) {
    this.sourceAccount = sourceAccount
    this.destinationAddress = destinationAddress
  }

  getSourceAccount(): AccountDetails {
    return this.sourceAccount
  }

  getDestinationAccount(): AccountDetails | undefined {
    if (this.destinationAsset) {
      return {
        ilpAddress: this.destinationAddress,
        ...this.destinationAsset
      }
    }
  }

  setDestinationAsset(assetCode: string, assetScale: AssetScale) {
    this.destinationAsset = {
      assetCode,
      assetScale
    }
  }

  nextState(builder: StreamRequestBuilder) {
    if (this.remoteAssetChanged) {
      return PaymentError.DestinationAssetConflict
    }

    // TODO What should the `ConnectionNewAddress` behavior be in "send only" mode?

    // Notify the recipient of our source account and other limits
    if (!this.remoteKnowsOurAccount) {
      if (this.sourceAccount) {
        // Share address with receiver (required by RFC)
        // `ilp-protocol-stream`, Rust & Java respond to this with a `ConnectionAssetDetails` frame
        builder.addFrames(new ConnectionNewAddressFrame(this.sourceAccount.ilpAddress))
      }

      builder.addFrames(
        // Disallow incoming money
        // `ilp-protocol-stream` auto opens a stream from this
        new StreamMaxMoneyFrame(DEFAULT_STREAM_ID, 0, 0),
        // Disallow incoming data
        new ConnectionMaxDataFrame(0),
        // Disallow any new streams
        new ConnectionMaxStreamIdFrame(DEFAULT_STREAM_ID)
      )
    }

    return SendState.Ready
  }

  applyFulfill(reply: StreamReply) {
    this.remoteKnowsOurAccount = true
    this.handleDestinationDetails(reply)
  }

  applyReject(reply: StreamReply) {
    this.remoteKnowsOurAccount = this.remoteKnowsOurAccount || isAuthentic(reply)
    this.handleDestinationDetails(reply)
  }

  private handleDestinationDetails({ responseFrames, log }: StreamReply) {
    const assetDetails = responseFrames?.find(
      (frame): frame is ConnectionAssetDetailsFrame =>
        frame.type === FrameType.ConnectionAssetDetails
    )
    if (!assetDetails) {
      return
    }

    const { sourceAssetScale: assetScale, sourceAssetCode: assetCode } = assetDetails
    if (!isValidAssetScale(assetScale)) {
      return // Deserializing the packet *should* already ensure the asset scale is u8
    }

    // Only set destination details if we don't already know them
    if (!this.destinationAsset) {
      this.destinationAsset = {
        assetCode,
        assetScale
      }
    }
    // If the destination asset details changed, end the payment
    else if (
      this.destinationAsset.assetCode !== assetCode ||
      this.destinationAsset.assetScale !== assetScale
    ) {
      log?.error(
        'ending payment: remote unexpectedly changed destination asset from %s %s to %s %s',
        this.destinationAsset.assetCode,
        this.destinationAsset.assetScale,
        assetCode,
        assetScale
      )
      this.remoteAssetChanged = true
    }
  }
}
