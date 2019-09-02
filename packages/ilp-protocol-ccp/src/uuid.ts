import { Reader, Writer } from 'oer-utils'

export const readUuid = (reader: Reader) => {
  const unformattedUuid = reader.read(16).toString('hex')

  return unformattedUuid.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
}

export const writeUuid = (writer: Writer, uuid: string) => {
  const uuidBuffer = Buffer.from(uuid.replace(/-/g, ''), 'hex')
  if (uuidBuffer.length !== 16) {
    throw new Error('tried to write invalid UUID. value=' + uuid)
  }
  writer.write(uuidBuffer)
}
