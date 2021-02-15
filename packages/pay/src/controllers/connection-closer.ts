import { StreamSender, SenderContext, SendState } from '.'
import { ConnectionCloseFrame, ErrorCode } from 'ilp-protocol-stream/dist/src/packet'
import { EstablishmentController } from './establishment'
import { SequenceController } from './sequence'
import { ExpiryController } from './expiry'

export class ConnectionCloser implements StreamSender<boolean> {
  // prettier-ignore
  readonly order = [
    SequenceController,
    EstablishmentController,
    ExpiryController,
  ]

  nextState({ request, send, lookup }: SenderContext<boolean>): SendState<boolean> {
    const didEstablish = lookup(EstablishmentController).didConnect()
    if (!didEstablish) {
      return SendState.Done(false)
    }

    // Try to send connection close frame on best-effort basis
    request.log.debug('trying to send connection close frame.')
    request.addFrames(new ConnectionCloseFrame(ErrorCode.NoError, ''))
    send(() =>
      // After request completes, finish send loop
      SendState.Done(true)
    )

    return SendState.Yield() // Don't schedule another attempt
  }
}
