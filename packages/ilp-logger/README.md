# ilp-logger
> Debug Logging utility for Interledger modules

## Usage

```
const logger = require('ilp-loggger')('DEBUG_NAMESPACE')

logger.info('Informational output.')
logger.warn('Something you want to warn for.')
logger.error('Something error-relevant.')
logger.debug('Extra but useful information.')
logger.trace('Superflous to normal output, but useful for detailed logs.')
```
