import { StreamController, StreamReply, StreamRequestBuilder, SendState } from '.'
import {
  ConnectionNewAddressFrame,
  ConnectionAssetDetailsFrame,
  FrameType,
  StreamMaxMoneyFrame,
  ConnectionMaxDataFrame,
  ConnectionMaxStreamIdFrame,
} from 'ilp-protocol-stream/dist/src/packet'
import { DEFAULT_STREAM_ID } from './amount'
import { AssetScale } from '../setup/open-payments'
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

  getDestinationAccount(): AccountDetails | undefined {
    if (this.destinationAsset) {
      return {
        ilpAddress: this.destinationAddress,
        ...this.destinationAsset,
      }
    }
  }

  setDestinationAsset(assetCode: string, assetScale: AssetScale) {
    this.destinationAsset = {
      assetCode,
      assetScale,
    }
  }

  nextState(builder: StreamRequestBuilder) {
    if (this.remoteAssetChanged) {
      return PaymentError.DestinationAssetConflict
    }

    // TODO What should the `ConnectionNewAddress` behavior be in "send only" mode?

    // Notify the recipient of our source account and other limits
    if (!this.remoteKnowsOurAccount) {
      builder.addFrames(
        // Share address with receiver (required by RFC)
        // `ilp-protocol-stream`, Rust & Java respond to this with a `ConnectionAssetDetails` frame
        new ConnectionNewAddressFrame(this.sourceAccount.ilpAddress),
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

  applyRequest() {
    return (reply: StreamReply) => {
      this.remoteKnowsOurAccount = this.remoteKnowsOurAccount || reply.isAuthentic()
      this.handleDestinationDetails(reply)
    }
  }

  private handleDestinationDetails({ frames, log }: StreamReply) {
    const assetDetails = frames?.find(
      (frame): frame is ConnectionAssetDetailsFrame =>
        frame.type === FrameType.ConnectionAssetDetails
    )
    if (!assetDetails) {
      return
    }

    // Packet deserialization should already ensure the asset scale is limited to u8:
    // https://github.com/interledgerjs/ilp-protocol-stream/blob/8551fd498f1ff313da72f63891b9fa428212c31a/src/packet.ts#L274
    const { sourceAssetScale: assetScale, sourceAssetCode: assetCode } = assetDetails

    // Only set destination details if we don't already know them
    if (!this.destinationAsset) {
      this.destinationAsset = {
        assetCode,
        assetScale: assetScale as AssetScale, // TODO Remove this?
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
      this.remoteAssetChanged = true
    }
  }
}
