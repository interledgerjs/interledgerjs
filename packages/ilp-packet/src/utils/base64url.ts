export const base64ToBase64Url = (base64String: string): string =>
  base64String.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

export const bufferToBase64url = (buffer: Buffer): string =>
  base64ToBase64Url(buffer.toString('base64'))
