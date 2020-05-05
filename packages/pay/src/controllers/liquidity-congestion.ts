// import { StreamController, StreamRequest, StreamReject } from './'
// import { Errors } from 'ilp-packet'
// import BigNumber from 'bignumber.js'
// import { Maybe } from 'true-myth'
// import { Integer, Rational, add, divide, multiply, floor, SAFE_ZERO } from '../utils'
// import { PacingController } from './pacer'
// import { ControllerMap } from './'

// enum PacketType {
//   Fulfill,
//   LiquidityError
// }

// export class CongestionController implements StreamController {
//   /**
//    * Fulfilled and rejected packets in window, sorted oldest to newest.
//    * An epoch contains the last n fulfilled packets, all all T04 insufficient
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
//     return this.estimateBandwidth()
//       .map(multiply(packetFrequency))
//       .map(floor)
//   }

//   private estimateBandwidth(): Maybe<Rational> {
//     if (this.epochPackets.length === 0) {
//       return Maybe.nothing()
//     }

//     const oldestPacket = this.epochPackets[0]
//     const latestPacket = this.epochPackets[this.epochPackets.length - 1]

//     // TODO Latest packet timestamp, or current timestamp?
//     const epochDuration = new BigNumber(latestPacket.timestamp - oldestPacket.timestamp) as Integer // TODO Remove cast

//     const totalFulfilledInEpoch = this.epochPackets
//       .filter(packet => packet.type === PacketType.Fulfill)
//       .reduce((sum, { sourceAmount }) => add(sum)(sourceAmount), SAFE_ZERO)

//     // TODO Improve this logic -- use all T04s in window to compute bandwidth ceilings
//     //      at different points in time, then reduce to minimum

//     const bandwidthLimit =
//       latestPacket.type === PacketType.LiquidityError
//         ? // Total amount fulfilled + latest T04 amount is an upper bound on the available bandwidth
//           add(totalFulfilledInEpoch)(latestPacket.sourceAmount) // TODO This should still be limited by 1.4x
//         : // If no T04 in epoch, increase available bandwidth
//           multiply(totalFulfilledInEpoch)(new BigNumber(1.4) as Rational) // TODO What factor?

//     return divide(bandwidthLimit)(epochDuration)
//   }

//   applyFulfill({ sourceAmount }: StreamRequest) {
//     const numberFulfillsInEpoch = this.epochPackets.filter(
//       packet => packet.type === PacketType.Fulfill
//     ).length
//     if (numberFulfillsInEpoch >= this.pacer.getMaxNumberInFlightPackets()) {
//       // Remove the oldest Fulfill and all preceding packets
//       // Number of Fulfills within the epoch should always be *at most* 10
//       const oldestFulfill = this.epochPackets.findIndex(
//         packet => packet.type === PacketType.Fulfill
//       )
//       this.epochPackets.splice(0, oldestFulfill + 1)
//     }

//     this.epochPackets.push({
//       type: PacketType.Fulfill,
//       timestamp: Date.now(),
//       sourceAmount
//     })
//   }

//   applyReject({ sourceAmount, reject }: StreamReject) {
//     if (reject.code === Errors.codes.T04_INSUFFICIENT_LIQUIDITY) {
//       this.epochPackets.push({
//         type: PacketType.LiquidityError,
//         timestamp: Date.now(),
//         sourceAmount
//       })
//     }
//   }
// }
