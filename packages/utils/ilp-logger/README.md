# ilp-logger
> Debug Logging utility for Interledger modules

[![NPM Package](https://img.shields.io/npm/v/ilp-logger.svg?style=flat)](https://npmjs.org/package/ilp-logger)
[![CircleCI](https://circleci.com/gh/interledgerjs/ilp-logger.svg?style=shield)](https://circleci.com/gh/interledgerjs/ilp-logger)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com) [![Greenkeeper badge](https://badges.greenkeeper.io/interledgerjs/ilp-logger.svg)](https://greenkeeper.io/)

## Usage

```js
// Javascript
const logger = require('ilp-logger')('DEBUG_NAMESPACE')

//TypeScript
import createLogger from 'ilp-logger'
const logger = createLogger('DEBUG_NAMESPACE')


logger.info('Informational output.')
logger.warn('Something you want to warn for.')
logger.error('Something error-relevant.')
logger.debug('Extra but useful information.')
logger.trace('Superflous to normal output, but useful for detailed logs.')
```
