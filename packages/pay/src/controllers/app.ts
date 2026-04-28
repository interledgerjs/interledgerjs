import { RequestState, StreamController } from '.'
import { RequestBuilder, StreamReply, StreamRequest } from '../request'
import { StreamDataFrame } from 'ilp-protocol-stream/dist/src/packet'

// Injects application data on the first STREAM packet
export class AppController implements StreamController {
  private readonly appData?: Buffer
  private readonly streamId: number
  private isDelivered = false

  constructor(appData?: Uint8Array | string | Buffer, streamId = 1) {
    this.streamId = streamId
    if (appData) {
      this.appData = Buffer.isBuffer(appData) ? appData : Buffer.from(appData)
    }
  }

  buildRequest(request: RequestBuilder): RequestState {
    if (!this.appData || this.isDelivered) {
      return RequestState.Ready()
    }

    request.addFrames(new StreamDataFrame(this.streamId, 0, this.appData))

    return RequestState.Ready()
  }

  applyRequest(_request: StreamRequest): ((reply: StreamReply) => void) | undefined {
    if (!this.appData || this.isDelivered) {
      return
    }

    return (reply: StreamReply) => {
      if (reply.isAuthentic()) {
        this.isDelivered = true
      }
    }
  }
}
