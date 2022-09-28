import { IlpPluginBtpConstructorOptions } from 'ilp-plugin-btp'
import { Connection } from '../../src'
import { runCryptoTests } from '../crypto.spec'

interface StreamClientOptions {
  destinationAccount: string
  sharedSecret: string
}

interface MagicalWindow {
  makeStreamClient: (
    btpOpts: IlpPluginBtpConstructorOptions,
    opts: StreamClientOptions
  ) => Promise<Connection>
  streamClient?: Connection
  runCryptoTests: typeof runCryptoTests
}

export default MagicalWindow
