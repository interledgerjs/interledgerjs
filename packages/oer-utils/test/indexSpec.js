'use strict'

const assert = require('chai').assert

const index = require('..')
const indexReader = require('../reader')
const indexWriter = require('../writer')
const indexPredictor = require('../predictor')

const Reader = require('../src/lib/reader')
const Writer = require('../src/lib/writer')
const Predictor = require('../src/lib/predictor')

describe('index', function () {
  describe('main', function () {
    it('should expose Reader', function () {
      assert.equal(index.Reader, Reader)
    })

    it('should expose Writer', function () {
      assert.equal(index.Writer, Writer)
    })

    it('should expose Predictor', function () {
      assert.equal(index.Predictor, Predictor)
    })
  })

  describe('reader', function () {
    it('should expose Reader', function () {
      assert.equal(indexReader, Reader)
    })
  })

  describe('writer', function () {
    it('should expose Writer', function () {
      assert.equal(indexWriter, Writer)
    })
  })

  describe('predictor', function () {
    it('should expose Predictor', function () {
      assert.equal(indexPredictor, Predictor)
    })
  })
})
