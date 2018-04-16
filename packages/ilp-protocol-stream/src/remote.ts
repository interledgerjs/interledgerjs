import BigNumber from 'bignumber.js'

/**
 * Class to track our view of the remote entity's Connection and Streams
 */
export class RemoteConnection {
  closed: boolean
  streams: RemoteStream[]
  packetSequence: number
  sourceAccount?: string
  knowsOurAccount: boolean

  constructor () {
    this.closed = false
    this.streams = []
    this.knowsOurAccount = false
  }

  createStream (id: number) {
    this.streams[id] = new RemoteStream()
  }
}

export interface ByteSegment {
  startOffset: number,
  endOffset: number
}

/**
 * Class to keep track of the remote entity's view of a given Stream
 */
export class RemoteStream {
  closed: boolean
  receiveMax: BigNumber
  totalReceived: BigNumber

  // TODO switch to strings to save on memory
  remoteReceiveMax: BigNumber
  remoteTotalReceived: BigNumber

  byteOffsetMax: number
  segmentsAcked: ByteSegment[]

  constructor () {
    this.closed = false
    this.receiveMax = new BigNumber(Infinity)
    this.totalReceived = new BigNumber(0)

    this.remoteReceiveMax = new BigNumber(0)
    this.remoteTotalReceived = new BigNumber(0)

    // TODO should this start at 0 or the default starting point?
    this.byteOffsetMax = 0
    this.segmentsAcked = []
  }
}
