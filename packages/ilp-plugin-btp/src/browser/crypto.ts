// Note: this polyfill doesn't include `crypto.timingSafeEqual()`. The browser
// never runs a BTP server, so it doesn't need to compare tokens.

const { crypto } = self

export function randomBytes(
  size: number,
  callback: (err: Error | null, buf: Buffer) => void
): void {
  const randArray = new Uint8Array(size)
  const randValues = crypto.getRandomValues(randArray)
  callback(null, Buffer.from(randValues))
}
