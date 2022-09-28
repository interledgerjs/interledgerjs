// This code is executed within Chromium by Puppeteer.

import IlpPluginBtp from 'ilp-plugin-btp'
import { createConnection } from '../../src'
import MagicalWindow from './magical-window-interface'
import { runCryptoTests } from '../crypto.spec'

declare const window: Partial<MagicalWindow>

// Use a wrapper function, because for some reason attaching `Client` to `window`
// loses the constructor so the test can't use it.
window.makeStreamClient = async (btpOpts, opts) => {
  const clientPlugin = new IlpPluginBtp(btpOpts)
  return await createConnection({
    plugin: clientPlugin,
    destinationAccount: opts.destinationAccount,
    sharedSecret: Buffer.from(opts.sharedSecret, 'base64'),
    slippage: 0,
  })
}

window.runCryptoTests = runCryptoTests
