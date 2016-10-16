# OER Utils

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

### Parse a binary buffer

``` js
const Reader = require('oer-utils/reader')

const reader = Reader.from(new Buffer('1234', 'hex'))

const v1 = reader.readUInt8()
const v2 = reader.readUInt8()
```

### Write a binary file

``` js
const Writer = require('oer-utils/writer')

const writer = new Writer()

writer.writeUInt8(1)
writer.writeUInt8(2)

const buffer = writer.getBuffer()
```
