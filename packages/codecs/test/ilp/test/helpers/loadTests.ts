'use strict'

import fs = require('fs')
import path = require('path')

export default ({ type }: { type: string }) => {
  const validPath = path.resolve(__dirname, `../data/${type}/valid/`)
  const validTestFiles = fs.readdirSync(validPath)
  const validTests = validTestFiles.map((file: string) => fs.readFileSync(path.resolve(validPath, file), 'utf-8')).map(jsonString => JSON.parse(jsonString))

  return validTests
}
