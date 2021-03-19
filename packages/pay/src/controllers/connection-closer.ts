import { StreamSender, SendState, GetController } from '.'
import { ConnectionCloseFrame, ErrorCode } from 'ilp-protocol-stream/dist/src/packet'
import { EstablishmentController } from './establishment'
import { SequenceController } from './sequence'
import { ExpiryController } from './expiry'
import { RequestBuilder } from '../request'

export class ConnectionCloser implements StreamSender<boolean> {
  // prettier-ignore
  readonly order = [
    SequenceController,
    EstablishmentController,
    ExpiryController,
  ]

  private sentCloseFrame = false

  nextState(request: RequestBuilder, lookup: GetController): SendState<boolean> {
    const didEstablish = lookup(EstablishmentController).didConnect()
    if (!didEstablish) {
      return SendState.Done(false)
    } else if (this.sentCloseFrame) {
      return SendState.Yield() // Don't schedule another attempt
    }

    // Try to send connection close frame on best-effort basis
    request.log.debug('trying to send connection close frame.')
    request.addFrames(new ConnectionCloseFrame(ErrorCode.NoError, ''))

    this.sentCloseFrame = true
    return SendState.Send(() =>
      // After request completes, finish send loop
      SendState.Done(true)
    )
  }
}
