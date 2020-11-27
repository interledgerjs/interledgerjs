import { SendLoop } from '.'
import { AssetDetails, AssetDetailsController } from './asset-details'
import { PaymentError } from '..'
import { ConnectionNewAddressFrame } from 'ilp-protocol-stream/dist/src/packet'
import { IlpAddress } from 'ilp-packet'
import { RequestBuilder, StreamRequest } from '../request'
import { EstablishmentController } from './establishment'
import { ExpiryController } from './expiry'
import { SequenceController } from './sequence'
import { InFlightTracker } from './pending-requests'

/** Send requests that trigger receiver to respond with asset details */
export class AssetProbe extends SendLoop<AssetDetails> {
  order = [
    SequenceController,
    EstablishmentController,
    ExpiryController,
    AssetDetailsController,
    InFlightTracker,
  ]

  // Immediately send two packets to "request" the destination asset details
  async trySending(
    request: StreamRequest
  ): Promise<
    AssetDetails | PaymentError.EstablishmentFailed | PaymentError.UnknownDestinationAsset
  > {
    /**
     * `ConnectionNewAddress` with an empty string will trigger `ilp-protocol-stream`
     * to respond with asset details but *not* trigger a send loop.
     *
     * However, Interledger.rs will reject this packet since it considers the frame invalid.
     */
    const assetRequest = this.send(
      new RequestBuilder(request).addFrames(new ConnectionNewAddressFrame('')).build()
    )

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
    const destinationAddress = [...segments.slice(0, -1), '_', ...segments.slice(-1)]
      .join('.')
      .substring(0, 1023) as IlpAddress
    const rustAssetRequest = this.send(
      new RequestBuilder(request)
        .addFrames(new ConnectionNewAddressFrame('private.RECEIVE_ONLY_CLIENT'))
        .setDestinationAddress(destinationAddress)
        .build()
    )

    // After replies for both the requests are processed,
    // resolve the probe with the asset details or error
    await Promise.all([assetRequest, rustAssetRequest])
    const didConnect = this.controllers.get(EstablishmentController).didConnect()
    const assetDetails = this.controllers.get(AssetDetailsController).getDestinationAsset()
    return !didConnect
      ? PaymentError.EstablishmentFailed
      : assetDetails ?? PaymentError.UnknownDestinationAsset
  }
}
