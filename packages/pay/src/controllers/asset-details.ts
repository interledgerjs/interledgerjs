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

    // We can't receive packets, so only send a `ConnectionNewAddress` for backwards
    // compatbility to fetch asset details. If we already know asset detatils, skip this!
    if (!this.destinationAsset) {
      /**
       * Interledger.rs, Interledger4j, and `ilp-protocol-stream` < 2.5.0
       * base64 URL encode 18 random bytes for the connection token (length 24).
       *
       * But... `ilp-protocol-stream` >= 2.5.0 encrypts it using the server
       * secret, identifing that version, which is widely used in production.
       */
      const connectionToken = this.destinationAddress.split('.').slice(-1)[0]
      if (connectionToken.length === 24) {
        /**
         * Interledger.rs rejects with an F02 if we send a `ConnectionNewAddress` frame with an invalid (e.g. empty) address.
         *
         * Since both Rust & Java won't ever send any packets, we can use any address here, since it's just so they reply
         * with asset details.
         */
        builder.addFrames(new ConnectionNewAddressFrame(this.sourceAccount.ilpAddress))
      } else {
        /**
         * For `ilp-protocol-stream` >= 2.5.0, send `ConnectionNewAddress`
         * with an empty address, which will (1) trigger a reply with asset details,
         * and (2) not trigger a send loop.
         */
        builder.addFrames(new ConnectionNewAddressFrame(''))
      }
    }

    // Notify the recipient of our limits
    if (!this.remoteKnowsOurAccount) {
      builder.addFrames(
        // Disallow incoming money (JS auto opens a new stream for this)
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
    frames
      ?.filter(
        (frame): frame is ConnectionAssetDetailsFrame =>
          frame.type === FrameType.ConnectionAssetDetails
      )
      .forEach((assetDetails) => {
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
      })
  }
}
