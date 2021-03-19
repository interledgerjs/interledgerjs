import { StreamSender, SendState, GetController } from '.'
import { AssetDetails, AssetDetailsController } from './asset-details'
import { PaymentError } from '..'
import { ConnectionNewAddressFrame } from 'ilp-protocol-stream/dist/src/packet'
import { IlpAddress } from 'ilp-packet'
import { EstablishmentController } from './establishment'
import { ExpiryController } from './expiry'
import { SequenceController } from './sequence'
import { RequestBuilder } from '../request'

/** Send requests that trigger receiver to respond with asset details */
export class AssetProbe implements StreamSender<AssetDetails> {
  readonly order = [
    SequenceController,
    EstablishmentController,
    ExpiryController,
    AssetDetailsController,
  ]

  private requestsSent = 0
  private gotFirstReply = false

  // Immediately send two packets to "request" the destination asset details
  nextState(request: RequestBuilder, lookup: GetController): SendState<AssetDetails> {
    const assetDetails = lookup(AssetDetailsController).getDestinationAsset()
    if (assetDetails) {
      return SendState.Done(assetDetails)
    }

    if (this.requestsSent === 0) {
      /**
       * `ConnectionNewAddress` with an empty string will trigger `ilp-protocol-stream`
       * to respond with asset details but *not* trigger a send loop.
       *
       * However, Interledger.rs will reject this packet since it considers the frame invalid.
       */
      request.addFrames(new ConnectionNewAddressFrame('')).build()
      request.log.debug('requesting asset details (1 of 2).')
    } else if (this.requestsSent === 1) {
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
      request
        .addFrames(new ConnectionNewAddressFrame('private.RECEIVE_ONLY_CLIENT'))
        .setDestinationAddress(destinationAddress)
        .build()
      request.log.debug('requesting asset details (2 of 2).')
    } else {
      return SendState.Yield()
    }

    this.requestsSent++
    return SendState.Send(() => {
      if (!this.gotFirstReply) {
        this.gotFirstReply = true
        return SendState.Yield()
      }

      const didConnect = lookup(EstablishmentController).didConnect()
      const assetDetails = lookup(AssetDetailsController).getDestinationAsset()
      return !didConnect
        ? SendState.Error(PaymentError.EstablishmentFailed)
        : !assetDetails
        ? SendState.Error(PaymentError.UnknownDestinationAsset)
        : SendState.Done(assetDetails)
    })
  }
}
