# OER Utils

[![npm][npm-image]][npm-url]

[npm-image]: https://img.shields.io/npm/v/oer-utils.svg?style=flat
[npm-url]: https://npmjs.org/package/oer-utils

> Collection of tools for OER parsing and serialization

## Usage

```sh
npm install oer-utils
```

## Numbers in `oer-utils`

This module uses the [`long`](https://github.com/dcodeIO/long.js) library to avoid issues with JavaScript numbers.

`Writer` methods for writing integers, like `writeUInt8` or `writeVarInt`, accept numbers, strings, or `Long`s.

The `Reader` exposes methods for reading integers that return strings, such as `readInt16` and `readVarUInt`, as well as methods that return `Long`s, such as `readInt16Long` and `readVarUIntLong`.

Note that if the `long` API changes, there will be breaking changes to the `read...Long` methods. These methods may be used to avoid unnecessary string conversions, but they may be less stable in the long term than the methods that export strings.

## Examples

### Parse a binary buffer

```js
const Reader = require('oer-utils/reader')

const reader = Reader.from(new Buffer('1234', 'hex'))

const v1 = reader.readUInt8()
const v2 = reader.readUInt8Long()
```

### Write a binary file

```js
const Writer = require('oer-utils/writer')
const Long = require('long')

const writer = new Writer()

writer.writeUInt8(1)
writer.writeUInt8(Long.fromNumber(2, true))

const buffer = writer.getBuffer()
```
