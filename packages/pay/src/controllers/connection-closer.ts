import { SendLoop } from '.'
import { ConnectionCloseFrame, ErrorCode } from 'ilp-protocol-stream/dist/src/packet'
import { EstablishmentController } from './establishment'
import { StreamRequest } from '../request'
import { PaymentError } from '..'
import { SequenceController } from './sequence'
import { InFlightTracker } from './pending-requests'
import { ExpiryController } from './expiry'

export class ConnectionCloser extends SendLoop<true> {
  // prettier-ignore
  order = [
    SequenceController,
    EstablishmentController,
    ExpiryController,
    InFlightTracker // TODO remove?
  ]

  async trySending(request: StreamRequest): Promise<void | PaymentError> {
    const didConnect = this.controllers.get(EstablishmentController).didConnect()
    if (didConnect) {
      // Try to send connection close frame
      // (wait for reply so plugin isn't accidentally closed before this is sent)
      await this.send({
        ...request,
        frames: [new ConnectionCloseFrame(ErrorCode.NoError, '')],
      })
    }

    // TODO What to do if it KNOWS no more requests will be sent?

    // return this.resolve()
  }

  finalize(): true | PaymentError | false {
    // TODO
    return true
  }
}
