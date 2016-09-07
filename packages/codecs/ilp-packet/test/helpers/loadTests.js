'use strict'

const fs = require('fs')
const path = require('path')

module.exports = ({ type }) => {
  const validPath = path.resolve(__dirname, `../data/${type}/`)
  const validTestFiles = fs.readdirSync(validPath)
  const validTests = validTestFiles.map(file => fs.readFileSync(path.resolve(validPath, file), 'utf-8')).map(JSON.parse)

  return validTests
}
