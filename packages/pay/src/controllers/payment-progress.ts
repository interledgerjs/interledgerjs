import BigNumber from 'bignumber.js'
import { AssetScale } from 'ilp-protocol-ildcp'
import { Receipt } from '..'
import { Int } from '../utils'
import { ControllerMap, StreamController } from '.'
import { AmountController } from './amount'
import { AccountController, AccountDetails } from './asset-details'

/** Event handler triggered every time a packet is fulfilled */
export interface PaymentProgressHandler {
  (progress: Receipt): void
}

/** Notify sender when any money is delivered */
export class PaymentProgress implements StreamController {
  private amountController: AmountController
  private accountController: AccountController
  private handler: PaymentProgressHandler
  private sourceAccount: AccountDetails
  private destinationAccount?: AccountDetails
  private lastSent = Int.ZERO

  constructor(controllers: ControllerMap, handler: PaymentProgressHandler) {
    this.amountController = controllers.get(AmountController)
    this.accountController = controllers.get(AccountController)
    this.sourceAccount = this.accountController.getSourceAccount()
    this.handler = handler
  }

  applyRequest(): () => void {
    return () => {
      if (!this.destinationAccount) {
        this.destinationAccount = this.accountController.getDestinationAccount()
        if (!this.destinationAccount) return
      }
      const amountSent = this.amountController.getAmountSent()
      if (amountSent.isEqualTo(this.lastSent)) return
      this.lastSent = amountSent
      this.handler({
        amountSent: amountSent.toBigNumber().shiftedBy(-this.sourceAccount.assetScale),
        amountDelivered: this.amountController
          .getAmountDelivered()
          .toBigNumber()
          .shiftedBy(-this.destinationAccount.assetScale),
        sourceAccount: this.sourceAccount,
        destinationAccount: this.destinationAccount,
      })
    }
  }
}
