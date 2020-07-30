import { StreamController, StreamReply, NextRequest, StreamRequest } from '.'
import {
  ConnectionNewAddressFrame,
  ConnectionAssetDetailsFrame,
  FrameType,
  ConnectionMaxDataFrame,
  ConnectionMaxStreamIdFrame,
  ErrorCode,
} from 'ilp-protocol-stream/dist/src/packet'
import { DEFAULT_STREAM_ID } from './payment'
import { PaymentError } from '..'
import { IlpAddress, isValidIlpAddress } from 'ilp-packet'
import { AssetScale } from 'ilp-protocol-ildcp'

// TODO Remove this type?
/** Asset and Interledger address for an account (sender or receiver) */
export interface AccountDetails extends AssetDetails {
  /** Interledger address of the account */
  ilpAddress: IlpAddress
}

/** Asset information for an Interledger account */
export interface AssetDetails {
  /** Precision of the asset denomination: number of decimal places of the normal unit */
  assetScale: AssetScale
  /** Asset code or symbol identifying the currency of the account */
  assetCode: string
}

/**
 * TODO Should these be stand-alone packets instead?
 * e.g., since one of them will fail, it's taking up precious bandwidth
 * in the WM case!
 */

// TODO One problem with this: it will keep retrying the asset request, but
//      the rate probe may never fail since it never gets to the "nextState" part of the probe
//      (e.g. if it keeps encountering T04s and backs off a ton)

/** Controller for sharing source/destination account details */
export class AssetDetailsController implements StreamController {
  private destinationAsset?: AssetDetails

  private remoteKnowsOurLimits = false
  private remoteAssetChanged = false

  private sentAssetRequest = false
  private sentRustAssetRequest = false

  constructor(destinationAsset?: AssetDetails) {
    this.destinationAsset = destinationAsset
  }

  getDestinationAsset(): AssetDetails | undefined {
    return this.destinationAsset
  }

  nextState(request: NextRequest): PaymentError | void {
    if (this.remoteAssetChanged) {
      request.addConnectionClose(ErrorCode.ProtocolViolation).send()
      return PaymentError.DestinationAssetConflict
    }

    // Continue sending connection limits in each packet until we receive an authenticated response
    if (!this.remoteKnowsOurLimits) {
      request.addFrames(
        // Disallow any new streams (and only the client can open streamId=1)
        new ConnectionMaxStreamIdFrame(DEFAULT_STREAM_ID),
        // Disallow incoming data
        new ConnectionMaxDataFrame(0)
      )
    }

    // If destination asset details are unknown, initially send 2 test packets to request them.
    if (!this.destinationAsset) {
      if (!this.sentAssetRequest) {
        /**
         * `ConnectionNewAddress` with an empty string will trigger `ilp-protocol-stream`
         * to respond with asset details but *not* trigger a send loop.
         *
         * However, Interledger.rs will reject this packet since it considers the frame invalid.
         */
        request.addFrames(new ConnectionNewAddressFrame(''))
      } else if (!this.sentRustAssetRequest) {
        /**
         * `ConnectionNewAddress` with a non-empty string is the only way to trigger Interledger.rs
         * to respond with asset details.
         *
         * But since `ilp-protocol-stream` would trigger a send loop and terminate the payment
         * to a send-only client, insert a dummy segment before the connection token.
         * Interledger.rs should handle the packet, but `ilp-protocol-stream` should reject it
         * without triggering a send loop.
         */
        const segments = request.destinationAddress.split('.')
        const address = [...segments.slice(0, -1), '_', ...segments.slice(-1)].join('.')
        if (isValidIlpAddress(address)) {
          request
            .setDestinationAddress(address)
            .addFrames(new ConnectionNewAddressFrame('private.RECEIVE_ONLY_CLIENT'))
        }
      }
    }
  }

  applyRequest({ requestFrames }: StreamRequest): (reply: StreamReply) => void {
    const addressFrame = requestFrames.find(
      (f): f is ConnectionNewAddressFrame => f.type === FrameType.ConnectionNewAddress
    )

    const isAssetRequest = addressFrame?.sourceAccount === ''
    if (isAssetRequest) {
      this.sentAssetRequest = true
    }

    const isRustAssetRequest = addressFrame && addressFrame.sourceAccount.length > 0
    if (isRustAssetRequest) {
      this.sentRustAssetRequest = true
    }

    return (reply: StreamReply): void => {
      // Retry sending the asset details request if they fail due to a non-final error
      if (!reply.isAuthentic() && reply.isReject() && reply.ilpReject.code[0] !== 'F') {
        if (isAssetRequest) {
          this.sentAssetRequest = false
        } else if (isRustAssetRequest) {
          this.sentRustAssetRequest = false
        }
      }

      this.remoteKnowsOurLimits = this.remoteKnowsOurLimits || reply.isAuthentic()
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
        const { sourceAssetScale: assetScale, sourceAssetCode: assetCode } = assetDetails

        // Only set destination details if we don't already know them
        if (!this.destinationAsset) {
          log.trace('got destination asset details: %s %s', assetCode, assetScale)
          // Packet deserialization should already ensure the asset scale is limited to u8:
          // https://github.com/interledgerjs/ilp-protocol-stream/blob/8551fd498f1ff313da72f63891b9fa428212c31a/src/packet.ts#L274
          this.destinationAsset = {
            assetCode,
            assetScale: assetScale as AssetScale,
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
