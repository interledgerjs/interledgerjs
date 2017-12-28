// The OER encoding for GeneralizedTime is a variable length octet string
// containing the ASCII/IA5 representation of a ISO8601 combined date and time
// in the *basic* format without the "T" separator.
//
// This is a very roundabout way of saying that GeneralizedTime contains an
// ISO 8601 timestamp, but compared to JavaScript, we need to take out the
// hyphens ("-"), colons (":") and the "T".

function pad (n: number) {
  return n < 10
    ? '0' + n
    : String(n)
}

export const dateToInterledgerTime = (date: Date) => {
  return date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    (date.getUTCMilliseconds() / 1000).toFixed(3).slice(2, 5)
}

export const INTERLEDGER_TIME_LENGTH = 17
export const INTERLEDGER_TIME_REGEX =
  /^([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{3})$/

export const interledgerTimeToDate = (interledgerTime: string) => {
  const isoTimestamp = interledgerTime.replace(
    INTERLEDGER_TIME_REGEX,
    '$1-$2-$3T$4:$5:$6.$7')

  const date = new Date(isoTimestamp)

  if (!date.valueOf()) {
    throw new Error('invalid date')
  }

  return date
}

export const dateToGeneralizedTime = (date: Date) => {
  return date.toISOString().replace(/[\-T:]/g, '')
}

export const GENERALIZED_TIME_REGEX =
  /^([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2}\.[0-9]{3}Z)$/

export const generalizedTimeToDate = (generalizedTime: string) => {
  const isoTimestamp = generalizedTime.replace(
    GENERALIZED_TIME_REGEX,
    '$1-$2-$3T$4:$5:$6'
  )

  const date = new Date(isoTimestamp)

  if (!date.valueOf()) {
    throw new Error('invalid date')
  }

  return date
}
