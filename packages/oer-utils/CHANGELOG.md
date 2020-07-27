# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [5.1.2](https://github.com/interledgerjs/interledgerjs/compare/oer-utils@5.1.1...oer-utils@5.1.2) (2020-07-27)

**Note:** Version bump only for package oer-utils





## [5.1.1](https://github.com/interledgerjs/interledgerjs/compare/oer-utils@5.1.0...oer-utils@5.1.1) (2020-07-27)

**Note:** Version bump only for package oer-utils





# [5.1.0](https://github.com/interledgerjs/interledgerjs/compare/oer-utils@5.1.0-alpha.0...oer-utils@5.1.0) (2020-07-24)


### Features

* robust amount strategy, rate errors ([fdcb132](https://github.com/interledgerjs/interledgerjs/commit/fdcb1324e5e8285da528b60b5c23098324efb9dc))
* STREAM payment library alpha, ci updates ([#17](https://github.com/interledgerjs/interledgerjs/issues/17)) ([4e128bc](https://github.com/interledgerjs/interledgerjs/commit/4e128bcee372144c1324a73e8b51223a0b133f2e))
* **pay:** open payments support ([2d4ba19](https://github.com/interledgerjs/interledgerjs/commit/2d4ba19275b444e46845a9114537b624d939f5ae))





# 5.1.0-alpha.0 (2019-10-08)


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
