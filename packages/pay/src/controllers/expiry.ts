import { StreamController, NextRequest } from '.'

export class ExpiryController implements StreamController {
  /**
   * Maximum duration that a ILP Prepare can be in-flight before it should be rejected, in milliseconds.
   * This is longer than the payment timeout duration to account for the min message
   * window each connector may subtract from the expiry.
   */
  private static DEFAULT_PACKET_EXPIRY_MS = 30_000

  /** Expiry of Jan 1, 2100 to circumvent OS clock skew (connector will reduce expiry) */
  private static FAR_FUTURE_EXPIRY = new Date(4102444800000)

  /** TODO explain */
  private useFarFutureExpiry: boolean

  constructor(useFarFutureExpiry = false) {
    this.useFarFutureExpiry = useFarFutureExpiry
  }

  nextState(request: NextRequest): void {
    const expiry = this.useFarFutureExpiry
      ? ExpiryController.FAR_FUTURE_EXPIRY
      : new Date(Date.now() + ExpiryController.DEFAULT_PACKET_EXPIRY_MS)
    request.setExpiry(expiry)
  }
}
