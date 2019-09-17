'use strict'
const path = require('path')
const webpack = require('webpack')

module.exports = {
  mode: 'development',
  entry: './test/browser/main.js',
  resolve: {
    aliasFields: ['browser'],
    extensions: ['.tsx', '.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        options: { onlyCompileBundledFiles: true },
      }
    ]
  },
  output: {
    filename: 'dist/test/browser/bundle.js',
    path: path.resolve(__dirname, '../..'),
  },
  optimization: { usedExports: true },

  node: {
    console: true,
    fs: 'empty',
    net: 'empty',
    tls: 'empty',
    crypto: 'empty'
  }
}
