# OER Utils

[![Greenkeeper badge](https://badges.greenkeeper.io/interledgerjs/oer-utils.svg)](https://greenkeeper.io/)

[![npm][npm-image]][npm-url] [![circle][circle-image]][circle-url] [![codecov][codecov-image]][codecov-url]

[npm-image]: https://img.shields.io/npm/v/oer-utils.svg?style=flat
[npm-url]: https://npmjs.org/package/oer-utils
[circle-image]: https://circleci.com/gh/interledgerjs/oer-utils.svg?style=shield
[circle-url]: https://circleci.com/gh/interledgerjs/oer-utils
[codecov-image]: https://codecov.io/gh/interledgerjs/oer-utils/branch/master/graph/badge.svg
[codecov-url]: https://codecov.io/gh/interledgerjs/oer-utils

> Collection of tools for OER parsing and serialization

## Usage

``` sh
npm install oer-utils
```

## Numbers in `oer-utils`

This module uses the [`bignumber.js`](https://github.com/MikeMcl/bignumber.js/) library to avoid issues with JavaScript numbers.

`Writer` methods for writing integers, like `writeUInt8` or `writeVarInt`, accept numbers, strings, or `BigNumber`s.

The `Reader` exposes methods for reading integers that return strings, such as `readInt16` and `readVarUInt`, as well as methods that return `BigNumbers`, such as `readInt16BigNum` and `readVarUIntBigNum`.

Note that if the `bignumber.js` API changes, there will be breaking changes to the `read...BigNum` methods. These methods may be used to avoid unnecessary string conversions, but they may be less stable in the long term than the methods that export strings.

## Examples

### Parse a binary buffer

``` js
const Reader = require('oer-utils/reader')

const reader = Reader.from(new Buffer('1234', 'hex'))

const v1 = reader.readUInt8()
const v2 = reader.readUInt8BigNum()
```

### Write a binary file

``` js
const Writer = require('oer-utils/writer')
const BigNumber = require('bignumber.js')

const writer = new Writer()

writer.writeUInt8(1)
writer.writeUInt8(new BigNumber(2))

const buffer = writer.getBuffer()
```
