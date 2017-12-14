export const base64ToBase64Url = (base64String: string) => {
  return base64String
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

export const bufferToBase64url = (buffer: Buffer) => {
  return base64ToBase64Url(buffer.toString('base64'))
}
