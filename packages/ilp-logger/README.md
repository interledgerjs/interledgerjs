# ilp-logger

> Debug Logging utility for Interledger modules

[![NPM Package](https://img.shields.io/npm/v/ilp-logger.svg?style=flat)](https://npmjs.org/package/ilp-logger)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Usage

### JavaScript

```js
const logger = require('ilp-logger')('DEBUG_NAMESPACE')
```

### TypeScript

```ts
import createLogger from 'ilp-logger'
const logger = createLogger('DEBUG_NAMESPACE')

logger.info('Informational output.')
logger.warn('Something you want to warn for.')
logger.error('Something error-relevant.')
logger.debug('Extra but useful information.')
logger.trace('Superflous to normal output, but useful for detailed logs.')
```

## Project

This project is a good template for new Interledger.js projects. Use the structure as is and provide your code and tests.

### Folders

All source code is expected to be TypeScript and is placed in the `src` folder. Tests are put in the `test` folder.

The NPM package will not contain any TypeScript files (`*.ts`) but will have typings and source maps.

### Scripts

- `clean` : Cleans the build folder and test output
- `build` : Build the project
- `lint` : Run the linter over the project
- `test` : Run the unit tests and produce a code coverage report
