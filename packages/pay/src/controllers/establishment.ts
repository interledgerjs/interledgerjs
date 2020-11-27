import { StreamController } from '.'
import { IlpAddress } from 'ilp-packet'
import { StreamReply, StreamRequest, RequestBuilder } from '../request'
import {
  ConnectionMaxDataFrame,
  ConnectionMaxStreamIdFrame,
} from 'ilp-protocol-stream/dist/src/packet'
import { PaymentController } from './payment'

/** Direct packets to the receiver to establish the connection and share limits */
export class EstablishmentController implements StreamController {
  private isConnected = false

  constructor(private readonly destinationAddress: IlpAddress) {}

  didConnect(): boolean {
    return this.isConnected
  }

  nextState(request: StreamRequest): StreamRequest {
    const builder = new RequestBuilder(request).setDestinationAddress(this.destinationAddress)

    if (!this.isConnected) {
      builder.addFrames(
        // Disallow any new streams (and only the client can open streamId=1)
        new ConnectionMaxStreamIdFrame(PaymentController.DEFAULT_STREAM_ID),
        // Disallow incoming data
        new ConnectionMaxDataFrame(0)
      )
    }

    return builder.build()
  }

  applyRequest(): (reply: StreamReply) => void {
    return (reply: StreamReply) => {
      // Continue sending connection limits in each packet until we receive an authenticated response
      this.isConnected = this.isConnected || reply.isAuthentic()
    }
  }
}
