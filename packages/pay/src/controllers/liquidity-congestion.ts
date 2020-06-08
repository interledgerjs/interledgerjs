// import { StreamController, StreamRequest, StreamReject, StreamFulfill } from './'
// import { Errors } from 'ilp-packet'
// import BigNumber from 'bignumber.js'
// import { Integer, Rational } from '../utils'
// import { PacingController } from './pacer'
// import { ControllerMap } from './'

// enum PacketType {
//   Fulfill,
//   LiquidityError,
// }

// // TODO Set "minimum bandwidth" to some multiple of the max packet amount?

// export class CongestionController implements StreamController {
//   /**
//    * Fulfilled and rejected packets in window, sorted oldest to newest.
//    * An epoch contains the last n fulfilled packets, and all T04 insufficient
//    * liquidity errors in the same time interval.
//    */
//   private epochPackets: {
//     type: PacketType
//     timestamp: number
//     sourceAmount: Integer
//   }[] = []
//   private pacer: PacingController

//   constructor(controllers: ControllerMap) {
//     this.pacer = controllers.get(PacingController)
//   }

//   public getPacketAmount(): Maybe<Integer> {
//     // TODO Here's a problem: pacer freqency may not correspond to *actual* packet frequency
//     const packetFrequency = new BigNumber(this.pacer.getPacketFrequency()) as Rational
//     return this.estimateBandwidth().map(multiply(packetFrequency)).map(floor)
//   }

//   private estimateBandwidth(): number {
//     if (this.epochPackets.length === 0) {
//       return 0
//     }

//     const oldestPacket = this.epochPackets[0]
//     const latestPacket = this.epochPackets[this.epochPackets.length - 1]

//     const totalFulfilledInEpoch = this.epochPackets
//       .filter((packet) => packet.type === PacketType.Fulfill)
//       .map(({ sourceAmount }) => +sourceAmount)
//       .reduce((a, b) => a + b)

//     // TODO Improve this logic -- use all T04s in window to compute bandwidth ceilings
//     //      at different points in time, then reduce to minimum

//     // TODO What about on T04, set target to the middle between totalFulfilledInEpoch & totalFulfilled + sourceAmount?
//     const bandwidthLimit =
//       latestPacket.type === PacketType.LiquidityError
//         ? // Total amount fulfilled + latest T04 amount is an upper bound on the available bandwidth
//           totalFulfilledInEpoch + +latestPacket.sourceAmount // TODO This should still be limited by 1.4x
//         : // If no T04 in epoch, increase available bandwidth
//           totalFulfilledInEpoch * 1.4 // TODO What factor?

//     // TODO Latest packet timestamp, or current timestamp?
//     const epochDuration = latestPacket.timestamp - oldestPacket.timestamp
//     return bandwidthLimit / epochDuration
//   }

//   applyRequest({ sourceAmount }: StreamRequest) {
//     return (reply: StreamFulfill | StreamReject) => {
//       if (reply instanceof StreamFulfill) {
//         const numberFulfillsInEpoch = this.epochPackets.filter(
//           (packet) => packet.type === PacketType.Fulfill
//         ).length
//         if (numberFulfillsInEpoch >= this.pacer.getMaxNumberInFlightPackets()) {
//           // Remove the oldest Fulfill and all preceding packets
//           // Number of Fulfills within the epoch should always be *at most* 10
//           const oldestFulfill = this.epochPackets.findIndex(
//             (packet) => packet.type === PacketType.Fulfill
//           )
//           this.epochPackets.splice(0, oldestFulfill + 1)
//         }

//         this.epochPackets.push({
//           type: PacketType.Fulfill,
//           timestamp: Date.now(),
//           sourceAmount,
//         })
//       } else if (reply.ilpReject.code === Errors.codes.T04_INSUFFICIENT_LIQUIDITY) {
//         this.epochPackets.push({
//           type: PacketType.LiquidityError,
//           timestamp: Date.now(),
//           sourceAmount,
//         })
//       }
//     }
//   }
// }
