import { Writer } from 'oer-utils'
import { stringToTwoNumbers, twoNumbersToString } from './utils/uint64'
import BaseError = require('extensible-error')

export const codes = {
  F00_BAD_REQUEST: 'F00',
  F01_INVALID_PACKET: 'F01',
  F02_UNREACHABLE: 'F02',
  F03_INVALID_AMOUNT: 'F03',
  F04_INSUFFICIENT_DESTINATION_AMOUNT: 'F04',
  F05_WRONG_CONDITION: 'F05',
  F06_UNEXPECTED_PAYMENT: 'F06',
  F07_CANNOT_RECEIVE: 'F07',
  F08_AMOUNT_TOO_LARGE: 'F08',
  F99_APPLICATION_ERROR: 'F99',
  T00_INTERNAL_ERROR: 'T00',
  T01_PEER_UNREACHABLE: 'T01',
  T02_PEER_BUSY: 'T02',
  T03_CONNECTOR_BUSY: 'T03',
  T04_INSUFFICIENT_LIQUIDITY: 'T04',
  T05_RATE_LIMITED: 'T05',
  T99_APPLICATION_ERROR: 'T99',
  R00_TRANSFER_TIMED_OUT: 'R00',
  R01_INSUFFICIENT_SOURCE_AMOUNT: 'R01',
  R02_INSUFFICIENT_TIMEOUT: 'R02',
  R99_APPLICATION_ERROR: 'R99'
}

export class BadRequestError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.F00_BAD_REQUEST
  }
}

export class InvalidPacketError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.F01_INVALID_PACKET
  }
}

export class UnreachableError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.F02_UNREACHABLE
  }
}

export class InvalidAmountError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.F03_INVALID_AMOUNT
  }
}

export class InsufficientDestinationAmountError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.F04_INSUFFICIENT_DESTINATION_AMOUNT
  }
}

export class WrongConditionError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.F05_WRONG_CONDITION
  }
}

export class UnexpectedPaymentError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.F06_UNEXPECTED_PAYMENT
  }
}

export class CannotReceiveError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.F07_CANNOT_RECEIVE
  }
}

export interface AmountTooLargeErrorOpts {
  receivedAmount: string,
  maximumAmount: string
}

export class AmountTooLargeError extends BaseError {
  public ilpErrorCode: string
  public ilpErrorData: Buffer
  constructor (message: string, opts: AmountTooLargeErrorOpts) {
    super(message)
    this.ilpErrorCode = codes.F08_AMOUNT_TOO_LARGE

    const writer = new Writer()
    writer.writeUInt64(stringToTwoNumbers(opts.receivedAmount))
    writer.writeUInt64(stringToTwoNumbers(opts.maximumAmount))

    this.ilpErrorData = writer.getBuffer()
  }
}

export class FinalApplicationError extends BaseError {
  public ilpErrorCode: string
  public ilpErrorData: Buffer
  constructor (message: string, data: Buffer) {
    super(message)
    this.ilpErrorCode = codes.F99_APPLICATION_ERROR
    this.ilpErrorData = data
  }
}

export class InternalError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.T00_INTERNAL_ERROR
  }
}

export class PeerUnreachableError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.T01_PEER_UNREACHABLE
  }
}

export class PeerBusyError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.T02_PEER_BUSY
  }
}

export class ConnectorBusyError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.T03_CONNECTOR_BUSY
  }
}

export class InsufficientLiquidityError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.T04_INSUFFICIENT_LIQUIDITY
  }
}

export class RateLimitedError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.T05_RATE_LIMITED
  }
}

export class TemporaryApplicationError extends BaseError {
  public ilpErrorCode: string
  public ilpErrorData: Buffer
  constructor (message: string, data: Buffer) {
    super(message)
    this.ilpErrorCode = codes.T99_APPLICATION_ERROR
    this.ilpErrorData = data
  }
}

export class TransferTimedOutError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.R00_TRANSFER_TIMED_OUT
  }
}

export class InsufficientSourceAmountError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.R01_INSUFFICIENT_SOURCE_AMOUNT
  }
}

export class InsufficientTimeoutError extends BaseError {
  public ilpErrorCode: string
  constructor (message: string) {
    super(message)
    this.ilpErrorCode = codes.R02_INSUFFICIENT_TIMEOUT
  }
}

export class RelativeApplicationError extends BaseError {
  public ilpErrorCode: string
  public ilpErrorData: Buffer
  constructor (message: string, data: Buffer) {
    super(message)
    this.ilpErrorCode = codes.R99_APPLICATION_ERROR
    this.ilpErrorData = data
  }
}
