import { Writer } from 'oer-utils'

export enum IlpErrorCode {
  F00_BAD_REQUEST = 'F00',
  F01_INVALID_PACKET = 'F01',
  F02_UNREACHABLE = 'F02',
  F03_INVALID_AMOUNT = 'F03',
  F04_INSUFFICIENT_DESTINATION_AMOUNT = 'F04',
  F05_WRONG_CONDITION = 'F05',
  F06_UNEXPECTED_PAYMENT = 'F06',
  F07_CANNOT_RECEIVE = 'F07',
  F08_AMOUNT_TOO_LARGE = 'F08',
  F99_APPLICATION_ERROR = 'F99',
  T00_INTERNAL_ERROR = 'T00',
  T01_PEER_UNREACHABLE = 'T01',
  T02_PEER_BUSY = 'T02',
  T03_CONNECTOR_BUSY = 'T03',
  T04_INSUFFICIENT_LIQUIDITY = 'T04',
  T05_RATE_LIMITED = 'T05',
  T99_APPLICATION_ERROR = 'T99',
  R00_TRANSFER_TIMED_OUT = 'R00',
  R01_INSUFFICIENT_SOURCE_AMOUNT = 'R01',
  R02_INSUFFICIENT_TIMEOUT = 'R02',
  R99_APPLICATION_ERROR = 'R99',
}

export const codes = IlpErrorCode

export abstract class BaseIlpError extends Error {
  public abstract ilpErrorCode: IlpErrorCode
  public ilpErrorMessage?: string
  public ilpErrorData?: Buffer
}

export class BadRequestError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.F00_BAD_REQUEST as const
}

export class InvalidPacketError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.F01_INVALID_PACKET as const
}

export class UnreachableError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.F02_UNREACHABLE as const
}

export class InvalidAmountError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.F03_INVALID_AMOUNT as const
}

export class InsufficientDestinationAmountError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.F04_INSUFFICIENT_DESTINATION_AMOUNT as const
}

export class WrongConditionError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.F05_WRONG_CONDITION as const
}

export class UnexpectedPaymentError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.F06_UNEXPECTED_PAYMENT as const
}

export class CannotReceiveError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.F07_CANNOT_RECEIVE as const
}

export interface AmountTooLargeErrorOpts {
  receivedAmount: string
  maximumAmount: string
}

export class AmountTooLargeError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.F08_AMOUNT_TOO_LARGE as const
  public ilpErrorData: Buffer
  constructor(message: string, opts: AmountTooLargeErrorOpts) {
    super(message)

    const writer = new Writer(8 + 8)
    writer.writeUInt64(opts.receivedAmount)
    writer.writeUInt64(opts.maximumAmount)

    this.ilpErrorData = writer.getBuffer()
  }
}

export class FinalApplicationError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.F99_APPLICATION_ERROR as const
  public ilpErrorData: Buffer
  constructor(message: string, data: Buffer) {
    super(message)
    this.ilpErrorData = data
  }
}

export class InternalError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.T00_INTERNAL_ERROR as const
}

export class PeerUnreachableError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.T01_PEER_UNREACHABLE as const
}

export class PeerBusyError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.T02_PEER_BUSY as const
}

export class ConnectorBusyError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.T03_CONNECTOR_BUSY as const
}

export class InsufficientLiquidityError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.T04_INSUFFICIENT_LIQUIDITY as const
}

export class RateLimitedError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.T05_RATE_LIMITED as const
}

export class TemporaryApplicationError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.T99_APPLICATION_ERROR as const
  public ilpErrorData: Buffer
  constructor(message: string, data: Buffer) {
    super(message)
    this.ilpErrorData = data
  }
}

export class TransferTimedOutError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.R00_TRANSFER_TIMED_OUT as const
}

export class InsufficientSourceAmountError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.R01_INSUFFICIENT_SOURCE_AMOUNT as const
}

export class InsufficientTimeoutError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.R02_INSUFFICIENT_TIMEOUT as const
}

export class RelativeApplicationError extends BaseIlpError {
  public ilpErrorCode = IlpErrorCode.R99_APPLICATION_ERROR as const
  public ilpErrorData: Buffer
  constructor(message: string, data: Buffer) {
    super(message)
    this.ilpErrorData = data
  }
}
