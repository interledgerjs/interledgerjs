'use strict'

const assert = require('chai').assert

const loadTests = require('./helpers/loadTests')

const Parser = require('..')

describe('Parser', function () {
  describe('serialize', function () {
    describe('correctly serializes valid ilp packets', function () {
      const validTests = loadTests({ type: 'valid' })

      for (let test of validTests) {
        it(test.name, function () {
          const json = test.json

          const serialized = Parser.serialize(json)

          assert.deepEqual(serialized.toString('base64'), test.binary)
        })
      }
      console.log('validTests', validTests)
    })
  })

  describe('deserialize', function () {
    describe('correctly parses valid ilp packets', function () {
      const validTests = loadTests({ type: 'valid' })

      for (let test of validTests) {
        it(test.name, function () {
          const binary = new Buffer(test.binary, 'base64')

          const parsed = Parser.deserialize(binary)

          assert.deepEqual(parsed, test.json)
        })
      }
      console.log('validTests', validTests)
    })
  })
})
