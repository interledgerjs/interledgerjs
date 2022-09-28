# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [2.7.2-alpha.2](https://github.com/interledgerjs/ilp-protocol-stream/compare/ilp-protocol-stream@2.7.2-alpha.1...ilp-protocol-stream@2.7.2-alpha.2) (2022-09-28)


### Bug Fixes

* **stream:** update browser tests for webpack 5 ([dcc76bf](https://github.com/interledgerjs/ilp-protocol-stream/commit/dcc76bf71e559ccf935e863aec259f4f4d1da8d1))
* **stream:** use setTimeout over setImmediate ([17e87b0](https://github.com/interledgerjs/ilp-protocol-stream/commit/17e87b00af352476ea595ab65aa0247050441314))
* support node 18 ([62f9ce0](https://github.com/interledgerjs/ilp-protocol-stream/commit/62f9ce0fda7d5d1ac06dd8f55f499e522974011b)), closes [#284](https://github.com/interledgerjs/ilp-protocol-stream/issues/284)





## [2.7.2-alpha.1](https://github.com/interledgerjs/ilp-protocol-stream/compare/ilp-protocol-stream@2.7.2-alpha.0...ilp-protocol-stream@2.7.2-alpha.1) (2022-08-18)


### Bug Fixes

* **crypto-browser:** replace window object with self ([#291](https://github.com/interledgerjs/ilp-protocol-stream/issues/291)) ([897fa3f](https://github.com/interledgerjs/ilp-protocol-stream/commit/897fa3fe94b0119cb55a4890ba59beaeea465ed0))





## 2.7.2-alpha.0 (2022-05-04)


### Bug Fixes

* accurate totalReceived in StreamMaxMoney ([56c71a9](https://github.com/interledgerjs/ilp-protocol-stream/commit/56c71a9b572e6840afd7c2c9e001b561eff82cfa))
* add setRecevieMax to README example ([1a8cbc2](https://github.com/interledgerjs/ilp-protocol-stream/commit/1a8cbc275f4499fad44143e2fc5e8a132f69f7be))
* backwards compatibility with node 8 ([514bfe7](https://github.com/interledgerjs/ilp-protocol-stream/commit/514bfe79c3928af8104af056eea7f9a0f01c6b14))
* browser field needs to cover src and dist ([2c76519](https://github.com/interledgerjs/ilp-protocol-stream/commit/2c765190d9e4a39831053672ead884a1c10e5698))
* bump idle on outgoing packet ([04ce93e](https://github.com/interledgerjs/ilp-protocol-stream/commit/04ce93e0ba7a75470c4d2a3472beb2992af736f0))
* circleci + puppeteer, node-8 → node-12 ([f88c73a](https://github.com/interledgerjs/ilp-protocol-stream/commit/f88c73a5e8f5d88fb4dda31174f2c07ca67f8074))
* clean up the determineExchangeRate loop ([a2b6a9e](https://github.com/interledgerjs/ilp-protocol-stream/commit/a2b6a9efe585a4ffa59cc1708f2717bc91fcefbe))
* code review fixes from [@sublimator](https://github.com/sublimator) ([e1b8eca](https://github.com/interledgerjs/ilp-protocol-stream/commit/e1b8ecaa776f8077280584874ec92e7492aa8288))
* Connection::destroy() sends ApplicationError, not NoError ([11707e7](https://github.com/interledgerjs/ilp-protocol-stream/commit/11707e7ecb4cd07d2d4796e780fec8a4d77859a8))
* **connection:** fix double-loop race ([dd7101c](https://github.com/interledgerjs/ilp-protocol-stream/commit/dd7101c5cbf685e570fcb0fbf4e47d1116fc16d0)), closes [/github.com/coilhq/web-monetization-projects/pull/1390#issuecomment-748134302](https://github.com//github.com/coilhq/web-monetization-projects/pull/1390/issues/issuecomment-748134302)
* **connection:** log uncaught rejection on end ([4678b37](https://github.com/interledgerjs/ilp-protocol-stream/commit/4678b379b3c594eb58ab1d58b27ac6d33ed974bb))
* **connection:** properly handle sendData error ([253742f](https://github.com/interledgerjs/ilp-protocol-stream/commit/253742fb8f7eddb2d7a6771585ff00c1e339d8de))
* correct types file ([d4cae3e](https://github.com/interledgerjs/ilp-protocol-stream/commit/d4cae3e344730ae238269ff7e058fd88262a8bf6))
* correctly calculate max incoming offset ([e8db050](https://github.com/interledgerjs/ilp-protocol-stream/commit/e8db050ea7e201836b814c03c9370ee784ca044a))
* correctly report {readable,writable}Length ([c8216b2](https://github.com/interledgerjs/ilp-protocol-stream/commit/c8216b2dfe6502b95ee333dca0bbe333a8000d75))
* crypto_browser refactor, lint, tests ([456d30e](https://github.com/interledgerjs/ilp-protocol-stream/commit/456d30eda4576482ce7d68299c8785318b318b32))
* default slippage ([4c5bb53](https://github.com/interledgerjs/ilp-protocol-stream/commit/4c5bb5346586b16e25bb3c373b2ed07540cecaf9))
* don't allow writing data after stream.end ([7a6fd32](https://github.com/interledgerjs/ilp-protocol-stream/commit/7a6fd32a0ace37c9d9e76be9654d59359cd02c8a))
* don't double-emit 'close' event ([1ee3797](https://github.com/interledgerjs/ilp-protocol-stream/commit/1ee37976010b106aa11717060bfd697c2728eda9))
* don't reject packets on error in event handlers ([363e58f](https://github.com/interledgerjs/ilp-protocol-stream/commit/363e58faf9a81de40ba9e05399916cb770704ee9))
* don't send money when stream is closed ([03318d8](https://github.com/interledgerjs/ilp-protocol-stream/commit/03318d894cbbc603a3d673b4595dab53ac37fe54))
* don't use zero-indexed types ([912bfe1](https://github.com/interledgerjs/ilp-protocol-stream/commit/912bfe11ebbd6f5088bb68946e7366afb8bed720))
* ensure testIdle destroys connection ([21c4a0d](https://github.com/interledgerjs/ilp-protocol-stream/commit/21c4a0d878d5e39d63bc4d6b23647797d0e9867c))
* fixes for node-v12 ([4e6b399](https://github.com/interledgerjs/ilp-protocol-stream/commit/4e6b3996a839917b51ba46c1c46c16e1c7d7ee69))
* handle control frames from unfulfillable test packets ([0eb9788](https://github.com/interledgerjs/ilp-protocol-stream/commit/0eb9788b0725c8a7eb26324e7b1e5d448d49fa85))
* idle timeout unref ([377ed45](https://github.com/interledgerjs/ilp-protocol-stream/commit/377ed452112b2994651ecbd49f0dfe301dba0521))
* implement kincaid's suggestions ([9712416](https://github.com/interledgerjs/ilp-protocol-stream/commit/97124167dd69bf459c7d8671eafd2cb8a9f403b4))
* import ilp-logger ([#73](https://github.com/interledgerjs/ilp-protocol-stream/issues/73)) ([883187c](https://github.com/interledgerjs/ilp-protocol-stream/commit/883187ca8c7c4cab8f452fb9daab859377010fbf))
* include util in published files ([20f3848](https://github.com/interledgerjs/ilp-protocol-stream/commit/20f3848721c0b986cc5f169099bd3592dda720d8))
* logs ([82ba6a3](https://github.com/interledgerjs/ilp-protocol-stream/commit/82ba6a3d07bdafbf142ef2312f8ae0b3d99102d1))
* matdehaast's code review changes ([adab127](https://github.com/interledgerjs/ilp-protocol-stream/commit/adab127441f3d3e4d6d2a2c010b88577e6896254))
* **package:** update debug to version 4.0.0 ([4ae3e69](https://github.com/interledgerjs/ilp-protocol-stream/commit/4ae3e69554f7ac45f302cf6b69ef7795220b6e3b))
* **package:** update ilp-packet to version 3.0.0 ([efeacc4](https://github.com/interledgerjs/ilp-protocol-stream/commit/efeacc4f6595074fb74a4a3a29ec842006d8daf5))
* **package:** update oer-utils to version 3.0.1 ([71d1b6d](https://github.com/interledgerjs/ilp-protocol-stream/commit/71d1b6d20d07cfd4ddcc43bdde1c8296a5ec5db6))
* padding must come at end of frame ([513711d](https://github.com/interledgerjs/ilp-protocol-stream/commit/513711df1795cdd132facb07a2b22850cae162f3))
* server shutdown hangs if no client address ([619a15f](https://github.com/interledgerjs/ilp-protocol-stream/commit/619a15fb7f19c6a4b5ca67fc3307108801ad6e0d))
* **server:** correctly start idle timer ([17cd86b](https://github.com/interledgerjs/ilp-protocol-stream/commit/17cd86b0ec4e5cad4cc89c786047d013a84d01e3))
* **server:** throw if generateAddressAndSecret called before listen ([35173f5](https://github.com/interledgerjs/ilp-protocol-stream/commit/35173f5d06a6a071fb20a20347aa73d25f985465))
* share asset details more often ([db927af](https://github.com/interledgerjs/ilp-protocol-stream/commit/db927af27196dfd7f23678f429ad501f80e98f99))
* slippage of 0.01 enabled by default ([8991671](https://github.com/interledgerjs/ilp-protocol-stream/commit/899167104ebb3a29408ffcf5018ef871299c9f99))
* sublimator's code review ([95610a8](https://github.com/interledgerjs/ilp-protocol-stream/commit/95610a8e72889c6bf4d489afe139616345bdd337))
* track last packet exchange rate for rejected packets ([2c391a7](https://github.com/interledgerjs/ilp-protocol-stream/commit/2c391a72a3c7b598666e83b2f2e5883d87f33681))
* update comment on allowHalOpen and simplify test ([9caa25a](https://github.com/interledgerjs/ilp-protocol-stream/commit/9caa25a0a5200a02287df9f890bc7fea714617ef))
* update error codes to match spec ([5730f90](https://github.com/interledgerjs/ilp-protocol-stream/commit/5730f902949df33991e7e9d081762c0198ecf0ba))
* update package-lock ([911f19b](https://github.com/interledgerjs/ilp-protocol-stream/commit/911f19ba7efa3d817a5c41399ac2d0a7ac5335ef))


### Features

* accept secret generator for verifyReceipt ([b37292f](https://github.com/interledgerjs/ilp-protocol-stream/commit/b37292fad1c0879f6082f83a6ad026bfea5a5ee9))
* add basic data stream ([b99fc34](https://github.com/interledgerjs/ilp-protocol-stream/commit/b99fc34c09e83cdf5533dde752d5224bcfce65fc))
* add ConnectionOpts.exchangeRate ([6847e5e](https://github.com/interledgerjs/ilp-protocol-stream/commit/6847e5e7139035d19241a8dac05c7b31b4b6d5c8))
* add ConnectionOpts.maximumPacketAmount ([423f515](https://github.com/interledgerjs/ilp-protocol-stream/commit/423f5154892095410d9959cf77c7d7f2ea45ce01))
* add getExpiry option to createConnection ([3eb6ff5](https://github.com/interledgerjs/ilp-protocol-stream/commit/3eb6ff50994c7a404b8a080c4d008fc5fbfecac2)), closes [/github.com/interledgerjs/ilp-connector/blob/ff20aff6f064945ef4b616baaa06990c2592707a/src/services/route-builder.ts#L122](https://github.com//github.com/interledgerjs/ilp-connector/blob/ff20aff6f064945ef4b616baaa06990c2592707a/src/services/route-builder.ts/issues/L122)
* add idleTimeout ([811b435](https://github.com/interledgerjs/ilp-protocol-stream/commit/811b435a416c56148b2aa7cf19e09ae1db7b2207))
* add receipts ([#133](https://github.com/interledgerjs/ilp-protocol-stream/issues/133)) ([c188af7](https://github.com/interledgerjs/ilp-protocol-stream/commit/c188af77f6ffc779de5f10027b9e8b17d663564e))
* add timeout to sendTotal, receiveTotal ([25c9570](https://github.com/interledgerjs/ilp-protocol-stream/commit/25c957080b2c87ad05c8a0dff2d590d4ef1ebba0))
* allow connection buffer size to be configured ([8b3d324](https://github.com/interledgerjs/ilp-protocol-stream/commit/8b3d32462be7494b4c8bceebe6900a2f1d349c84))
* attach rejection to error ([ca53c1d](https://github.com/interledgerjs/ilp-protocol-stream/commit/ca53c1da270fcfdd0fcd50d50a6086c6d82057d1))
* basic MoneyStream ([88318c5](https://github.com/interledgerjs/ilp-protocol-stream/commit/88318c5947ac4b06623adb0b82e1da9c22aff761))
* change generateAddressAndSecret back to sync ([00c7a9d](https://github.com/interledgerjs/ilp-protocol-stream/commit/00c7a9d5950c210a10157fe5cded6375ed790feb))
* client streams should start with 1 ([ec1ece4](https://github.com/interledgerjs/ilp-protocol-stream/commit/ec1ece466161466b8538e1ee3914316e9dfc68d8))
* close connection if peer doesn't respect stream flow control limit ([a18f460](https://github.com/interledgerjs/ilp-protocol-stream/commit/a18f46021969cc714793fd3a70af67b980e0f375))
* close connection if peer exceeds flow control limit ([de545c3](https://github.com/interledgerjs/ilp-protocol-stream/commit/de545c38a667172e6f2edc80b44558b7a76f0ac6))
* close connection if peer uses wrong stream id ([b718bf1](https://github.com/interledgerjs/ilp-protocol-stream/commit/b718bf1b717b8d5b601d3fc6f4f1b93e3244df92))
* closing streams ([f8bba24](https://github.com/interledgerjs/ilp-protocol-stream/commit/f8bba240808b050231850c736521d54c9154d856))
* combine money and data streams ([1a7640c](https://github.com/interledgerjs/ilp-protocol-stream/commit/1a7640c3762cf6fc261d32651d7a5bce840ba818))
* communicate max stream id to peer ([557fe7d](https://github.com/interledgerjs/ilp-protocol-stream/commit/557fe7db711b226889a493c126ff2dbc32bba1bc))
* connection-level flow control ([e9be2bf](https://github.com/interledgerjs/ilp-protocol-stream/commit/e9be2bf9a97db27e86af2dac88a32a58f6190e9c))
* connection.destroy ([7e09e06](https://github.com/interledgerjs/ilp-protocol-stream/commit/7e09e06339876ed50f5c1d1013eee09f0e3223b3))
* connection.end ([4906412](https://github.com/interledgerjs/ilp-protocol-stream/commit/4906412feb2c2eda870c9f8c315bc87364af41b5))
* **connection:** expose source and destination account ([96c4748](https://github.com/interledgerjs/ilp-protocol-stream/commit/96c4748dc5e748b9a0313928513222c9644b88e5))
* **connection:** reduce rate exchange attempts to 15 ([630d271](https://github.com/interledgerjs/ilp-protocol-stream/commit/630d271a63acd3b89313e136d98378e2d0eaffd8))
* **connection:** remove closed streams ([69fb984](https://github.com/interledgerjs/ilp-protocol-stream/commit/69fb984025207e6677b9da996ca55ba74e97adb7))
* createServer, also add more typedoc comments ([6ecd837](https://github.com/interledgerjs/ilp-protocol-stream/commit/6ecd837dfce9f97466a8419e4989ca25b713982b))
* don't close streams until money has been sent ([9dcdcdd](https://github.com/interledgerjs/ilp-protocol-stream/commit/9dcdcdd15898ecec20909f5d7493800858e76880))
* drop connection after too many packets ([7d34acc](https://github.com/interledgerjs/ilp-protocol-stream/commit/7d34accdfcbd5ffa95808ed3a5049499b301f60d))
* export receipt utilities ([308b1d0](https://github.com/interledgerjs/ilp-protocol-stream/commit/308b1d0ebade56c9ea4dbf642c83a15b4571a300))
* export ReceiptWithHMAC ([116f15f](https://github.com/interledgerjs/ilp-protocol-stream/commit/116f15f2eaabf1e058916dec070a5857dd19655e))
* expose asset details ([#69](https://github.com/interledgerjs/ilp-protocol-stream/issues/69)) ([1a80aee](https://github.com/interledgerjs/ilp-protocol-stream/commit/1a80aeeeee45d126f1d8e1e62dea4302b4916527))
* handle F08 Maximum Payment Size errors ([ae1b682](https://github.com/interledgerjs/ilp-protocol-stream/commit/ae1b68248691315e356a56fd3c75b8ca0c862049))
* hold outgoing balance until packet is fulfilled ([ae7d108](https://github.com/interledgerjs/ilp-protocol-stream/commit/ae7d108002454281687f908f44321c3b8d52825d))
* initial API sketch ([46ca6c8](https://github.com/interledgerjs/ilp-protocol-stream/commit/46ca6c849efeaa70425add44a0407052b9168685))
* length-prefix frames array ([d9ecdd7](https://github.com/interledgerjs/ilp-protocol-stream/commit/d9ecdd707ca04ac316c53be4278700be68cfd6b2))
* limit max number of open streams ([03c4fa5](https://github.com/interledgerjs/ilp-protocol-stream/commit/03c4fa5a5ff3568e44725519f0686111f578c707))
* limit packet data to 32767 bytes ([1ba6e34](https://github.com/interledgerjs/ilp-protocol-stream/commit/1ba6e3473426a05490410725746678e5a8274a4a))
* load plugin from env if none is supplied ([7457a8c](https://github.com/interledgerjs/ilp-protocol-stream/commit/7457a8c3668831be51c12deb5c93fcf602da4ea8))
* min destination amount and slippage ([40f0a9a](https://github.com/interledgerjs/ilp-protocol-stream/commit/40f0a9a83958912554c25ed108733204fa9824fd))
* money stream backpressure ([4e31c6b](https://github.com/interledgerjs/ilp-protocol-stream/commit/4e31c6b37d4c4304ea0649b7e1f8756a78858d9b))
* MoneyStream.flushed and 2 basic tests ([ed8ec42](https://github.com/interledgerjs/ilp-protocol-stream/commit/ed8ec42ab505419de86a96348f590789f9f7fdaa))
* **MoneyStream:** allow receiveMax to be Infinity ([5e0e506](https://github.com/interledgerjs/ilp-protocol-stream/commit/5e0e50625f53b7e3f1a84e1ed484c0c206ede7f7))
* only 1 way to close streams ([4bbfb85](https://github.com/interledgerjs/ilp-protocol-stream/commit/4bbfb85236b48af37a304f4b4c3876f29a4aa216))
* optional padding ([f87cb42](https://github.com/interledgerjs/ilp-protocol-stream/commit/f87cb42635746f167c491338eea9dadf658743ce))
* overhaul frame types ([dca343a](https://github.com/interledgerjs/ilp-protocol-stream/commit/dca343ae39411a017af38df419887a36e9079c0c))
* packet format ([95db020](https://github.com/interledgerjs/ilp-protocol-stream/commit/95db020db4924d8c531c4ef16878df4d8211d51f))
* prevent replay attacks using packet numbers ([626c45b](https://github.com/interledgerjs/ilp-protocol-stream/commit/626c45b5965377f0d3bc49486c69fe256604e783))
* reduce packet amount on T04 errors ([d5f342c](https://github.com/interledgerjs/ilp-protocol-stream/commit/d5f342c725a133a6333e35057821e373c57641ad))
* remove ConnectionMaxMoney ([0527db7](https://github.com/interledgerjs/ilp-protocol-stream/commit/0527db7ee01c212f03b3d1807acc4b3131388be9))
* remove ilp-plugin as dependency ([b6bef01](https://github.com/interledgerjs/ilp-protocol-stream/commit/b6bef010e628d820437063ca904f48dcd701d827))
* rename money events ([e3f7091](https://github.com/interledgerjs/ilp-protocol-stream/commit/e3f70917befc3cbb15296797470eb9f77d57515c))
* retry on temporary errors ([4016236](https://github.com/interledgerjs/ilp-protocol-stream/commit/40162362b2ed66c6a47a1ce7026b2266579011d7))
* retry sending outgoing data ([ebf5259](https://github.com/interledgerjs/ilp-protocol-stream/commit/ebf525942a07af1b0b884ae589722b8324c1ca2e))
* retry test packets that get temporary errors ([c55fd4a](https://github.com/interledgerjs/ilp-protocol-stream/commit/c55fd4a6d10689b6500818c876e23d5369458c66))
* sendTestPacket to determine path exchange rate ([6b8121a](https://github.com/interledgerjs/ilp-protocol-stream/commit/6b8121a55ed0b295ce68295d8ca1299d30479439))
* server.close() ([245132a](https://github.com/interledgerjs/ilp-protocol-stream/commit/245132a05ac032300866670d5abdfdebfe71b75e))
* **server:** connectionTag ([05deff1](https://github.com/interledgerjs/ilp-protocol-stream/commit/05deff1dc7cf3d33bd5c2ad4eda3bf5a8e6a0aab))
* **server:** remove agingset ([ce63d10](https://github.com/interledgerjs/ilp-protocol-stream/commit/ce63d1042c7eccfe39f5f9b1917035145daf3a7b))
* **server:** remove closed connections ([140e1d4](https://github.com/interledgerjs/ilp-protocol-stream/commit/140e1d421fff1010cfb1c3265fd7c1785123c063))
* SourceAccountFrame ([5b983b0](https://github.com/interledgerjs/ilp-protocol-stream/commit/5b983b0b5dac27e467861e6e0b703707d40fd05e))
* split data across multiple packets ([38ea232](https://github.com/interledgerjs/ilp-protocol-stream/commit/38ea2327a067bee4d12e45e6a742e65ab78650b7))
* stream-level flow control and backpressure ([8d9ab14](https://github.com/interledgerjs/ilp-protocol-stream/commit/8d9ab141ecf1cfcfce5a787789faac0bd75ede59))
* stream.destroy accepts errors ([d64bc00](https://github.com/interledgerjs/ilp-protocol-stream/commit/d64bc003b598959ccd7a0e26fc11019981778aae))
* StreamMoneyBlockedFrame ([6d4d651](https://github.com/interledgerjs/ilp-protocol-stream/commit/6d4d6519c34b6d00cf55d31d2bac2eed22d1c4e1))
* support exchange rates with large scale differences ([82c6fee](https://github.com/interledgerjs/ilp-protocol-stream/commit/82c6fee57ed83ae487a354c32d1438e89ee0a4f0))
* support node versions >= v8.0.0 ([ed18d59](https://github.com/interledgerjs/ilp-protocol-stream/commit/ed18d593a539817aebfb3a045c5100828296d75f))
* travis' web crypto polyfill ([e1867d6](https://github.com/interledgerjs/ilp-protocol-stream/commit/e1867d6a2ee4da79b9644163b0c65a68bdbb89b3))
* update close connection behavior to emit expected events and expand end & destroy test coverage ([04bbd20](https://github.com/interledgerjs/ilp-protocol-stream/commit/04bbd20702c48c7c2c14719b4e4c75cd04b17427))
* web crypto (BREAKING) ([9749b99](https://github.com/interledgerjs/ilp-protocol-stream/commit/9749b99dc6d2ebe623c99559b104a754ec0611cb))


### Performance Improvements

* cache browser crypto keys ([44bc9a9](https://github.com/interledgerjs/ilp-protocol-stream/commit/44bc9a9c77a08511b0c5c4f86736d4e32422c45b))
* don't copy data when serializing ([8e7ba46](https://github.com/interledgerjs/ilp-protocol-stream/commit/8e7ba463b71362b6fadc5f5ef9139fa4756aa01b))
* fix logger memory leak ([3d1e944](https://github.com/interledgerjs/ilp-protocol-stream/commit/3d1e944024f01537ec1131450204749ff6a9dd75))
* **server:** clean up closed connections ([cd228bd](https://github.com/interledgerjs/ilp-protocol-stream/commit/cd228bdb4db6f945f6a5bfd1a9e0a333869e0022))
* skip probe packet when exchangeRate is fixed ([0ce69d3](https://github.com/interledgerjs/ilp-protocol-stream/commit/0ce69d3a83a43e424867333edee4a38b74a56321))
* use debug formatters ([acf8c8f](https://github.com/interledgerjs/ilp-protocol-stream/commit/acf8c8f21030f3be1a5567447e5350aeac75b0aa))
