// TODO Check to make sure Webpack doesn't shim this, otherwise use Sindre's hack:
// https://github.com/webpack/webpack/issues/8826
// https://github.com/sindresorhus/ow/blob/d62a06c192b892d504887f0b97fdc842e8cbf862/source/utils/node/require.ts
// eval('require')('crypto')
const crypto = module.require('crypto')

// TODO Now, add the subtle crypto shim -- requires no specialized webpack config!
