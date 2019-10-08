## 5.0.1 (2019-10-08)


### Bug Fixes

* **oer-utils:** revert breaking changes ([b7fc29c](https://github.com/interledgerjs/interledgerjs/commit/b7fc29c))
* ensure babel-cli is available ([df64cfb](https://github.com/interledgerjs/interledgerjs/commit/df64cfb))
* error message typos ([a0a6e0d](https://github.com/interledgerjs/interledgerjs/commit/a0a6e0d))
* implement working readUInt64 ([f921d98](https://github.com/interledgerjs/interledgerjs/commit/f921d98))
* make Predictor and Writer APIs match ([3225c44](https://github.com/interledgerjs/interledgerjs/commit/3225c44))
* make Predictor API match Writer ([44c8646](https://github.com/interledgerjs/interledgerjs/commit/44c8646))
* reject variable integers of length zero ([28262e3](https://github.com/interledgerjs/interledgerjs/commit/28262e3))
* set up class export shortcuts correctly ([fcaf27d](https://github.com/interledgerjs/interledgerjs/commit/fcaf27d))
* test missing it() block ([7493327](https://github.com/interledgerjs/interledgerjs/commit/7493327))
* **predictor:** fix passing buffers to writeVarUInt ([60abcc6](https://github.com/interledgerjs/interledgerjs/commit/60abcc6))
* **writer:** add missing return statement ([70e1100](https://github.com/interledgerjs/interledgerjs/commit/70e1100))
* **writer:** fix writeUInt64 ([1278a63](https://github.com/interledgerjs/interledgerjs/commit/1278a63))
* **writer:** refuse to write unsafe integers ([5b9c637](https://github.com/interledgerjs/interledgerjs/commit/5b9c637))
* **writer:** writeUInt should require positive length ([f14028c](https://github.com/interledgerjs/interledgerjs/commit/f14028c))
* **writer:** writeVarOctetString should expect buffer ([fb501ea](https://github.com/interledgerjs/interledgerjs/commit/fb501ea))


### Features

* **oer-utils:** BREAKING: switch BigNumber to Long ([e2e19b1](https://github.com/interledgerjs/interledgerjs/commit/e2e19b1))
* allow using JS numbers instead of BigNumbers ([027e26e](https://github.com/interledgerjs/interledgerjs/commit/027e26e))
* circleci config ([103594e](https://github.com/interledgerjs/interledgerjs/commit/103594e))
* import basic functionality ([688cb48](https://github.com/interledgerjs/interledgerjs/commit/688cb48))
* prependLengthPrefix ([5ce118c](https://github.com/interledgerjs/interledgerjs/commit/5ce118c))
* slice buffer when cloning readers ([eabe7ad](https://github.com/interledgerjs/interledgerjs/commit/eabe7ad))
* write another Writer without copying ([68d6598](https://github.com/interledgerjs/interledgerjs/commit/68d6598))
* **reader:** [BREAKING] return BigNumbers for all read int methods ([4af4b33](https://github.com/interledgerjs/interledgerjs/commit/4af4b33))
* **reader:** [BREAKING] return ints as strings, separate BigNumber methods ([e5ec7a1](https://github.com/interledgerjs/interledgerjs/commit/e5ec7a1))
* **writer:** accept BigNumbers ([5393a6f](https://github.com/interledgerjs/interledgerjs/commit/5393a6f))



