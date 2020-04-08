import { StreamController, StreamRequest, StreamRequestBuilder } from '.'
import { PaymentState } from '..'
import { Integer, SAFE_ZERO, add, subtract } from '../utils'
import { Maybe } from 'true-myth'

// TODO What if the fixed destination amount has yet to be fully paid? What should the behavior be?

/** Track the source amounts and the maximum we can send */
export class SourceAmountTracker implements StreamController {
  /** Maximum/total amount intended to be sent, in source units */
  private readonly amountToSend: Maybe<Integer>
  /** Total amount of in-flight packets yet to be fulfilled or rejected, in source units */
  private amountInFlight: Integer = SAFE_ZERO
  /** Total amount fulfilled and received by the recipient, in source units */
  private amountSent: Integer = SAFE_ZERO

  constructor(amountToSend: Maybe<Integer>) {
    this.amountToSend = amountToSend
  }

  nextState({ log }: StreamRequestBuilder): PaymentState {
    if (this.didOverpay()) {
      log.error(
        'ending payment: overpaid source amount limit. sent %s of %s',
        this.amountSent,
        this.amountToSend
      )
      return PaymentState.End
    }

    if (this.isComplete()) {
      log.debug('payment complete: paid fixed source amount. sent %s', this.amountSent)
      return PaymentState.End
    }

    if (this.isBlocked()) {
      return PaymentState.Wait
    }

    return PaymentState.SendMoney
  }

  getAmountSent(): Integer {
    return this.amountSent
  }

  /** Total source amount of all in-flight packets yet to be fulfilled or rejected */
  getAmountInFlight(): Integer {
    return this.amountInFlight
  }

  /** Amount yet to be fulfilled to send intended amount, in source units */
  getRemainingToSend(): Maybe<Integer> {
    return this.amountToSend
      .map(subtract)
      .ap(Maybe.just(this.amountSent))
      .chain(n => n)
  }

  /** Amount that can be safely be sent without overpaying, in source units */
  getAvailableToSend(): Maybe<Integer> {
    return this.getRemainingToSend()
      .map(subtract)
      .ap(Maybe.just(this.amountInFlight))
      .chain(n => n)
  }

  /** Would sending any more money risk overpayment? */
  private isBlocked(): boolean {
    return this.getAvailableToSend()
      .map(n => n.isZero())
      .unwrapOr(false)
  }

  /** Did we pay more than the source amount limit? */
  private didOverpay(): boolean {
    return this.amountToSend.map(n => this.amountSent.isGreaterThan(n)).unwrapOr(false)
  }

  /** Did we pay exactly the source amount limit? */
  private isComplete(): boolean {
    const paidFullAmount = this.amountToSend.map(n => n.isEqualTo(this.amountSent)).unwrapOr(false)
    return paidFullAmount && this.amountInFlight.isZero()
  }

  applyPrepare({ sourceAmount }: StreamRequest) {
    this.amountInFlight = add(this.amountInFlight)(sourceAmount)
  }

  applyFulfill({ sourceAmount }: StreamRequest) {
    this.amountInFlight = subtract(this.amountInFlight)(sourceAmount).unwrapOr(SAFE_ZERO) // Should never underflow
    this.amountSent = add(this.amountSent)(sourceAmount)
  }

  applyReject({ sourceAmount }: StreamRequest) {
    this.amountInFlight = subtract(this.amountInFlight)(sourceAmount).unwrapOr(SAFE_ZERO) // Should never underflow
  }
}
