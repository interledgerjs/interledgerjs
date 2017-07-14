export function isInteger (value: any) {
  return typeof value !== 'object'
    && typeof value !== 'function'
    && isFinite(value)
    && Math.floor(value) === value
}
