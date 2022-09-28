# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [3.1.4-alpha.2](https://github.com/interledgerjs/interledgerjs/compare/ilp-packet@3.1.4-alpha.1...ilp-packet@3.1.4-alpha.2) (2022-09-28)

**Note:** Version bump only for package ilp-packet





## [3.1.4-alpha.1](https://github.com/interledgerjs/interledgerjs/compare/ilp-packet@3.1.4-alpha.0...ilp-packet@3.1.4-alpha.1) (2022-05-04)

**Note:** Version bump only for package ilp-packet





## [3.1.4-alpha.0](https://github.com/interledgerjs/interledgerjs/compare/ilp-packet@3.1.3...ilp-packet@3.1.4-alpha.0) (2022-04-27)

**Note:** Version bump only for package ilp-packet





## [3.1.3](https://github.com/interledgerjs/interledgerjs/compare/ilp-packet@3.1.2...ilp-packet@3.1.3) (2021-10-25)

### Bug Fixes

- **ilp-packet:** test address on decoding prepare ([5d3ace2](https://github.com/interledgerjs/interledgerjs/commit/5d3ace240e4c24eda4bd16855af15ec09b4d437c))

## [3.1.2](https://github.com/interledgerjs/interledgerjs/compare/ilp-packet@3.1.1...ilp-packet@3.1.2) (2020-07-27)

**Note:** Version bump only for package ilp-packet

## [3.1.1](https://github.com/interledgerjs/interledgerjs/compare/ilp-packet@3.1.0...ilp-packet@3.1.1) (2020-07-27)

**Note:** Version bump only for package ilp-packet

# [3.1.0](https://github.com/interledgerjs/interledgerjs/compare/ilp-packet@3.1.0-alpha.0...ilp-packet@3.1.0) (2020-07-24)

### Features

- stateless stream receiver ([aed91d8](https://github.com/interledgerjs/interledgerjs/commit/aed91d85c06aa73af77a8c3891d388257b74ede8))
- STREAM payment library alpha, ci updates ([#17](https://github.com/interledgerjs/interledgerjs/issues/17)) ([4e128bc](https://github.com/interledgerjs/interledgerjs/commit/4e128bcee372144c1324a73e8b51223a0b133f2e))

# 3.1.0-alpha.0 (2019-10-08)

### Bug Fixes

- better errors for undefined params ([1530ad2](https://github.com/interledgerjs/interledgerjs/commit/1530ad2))
- ensure that UTC timezone is included in date ([bf7531e](https://github.com/interledgerjs/interledgerjs/commit/bf7531e))
- export interfaces ([80379cd](https://github.com/interledgerjs/interledgerjs/commit/80379cd))
- optional typeString ([ce91dd6](https://github.com/interledgerjs/interledgerjs/commit/ce91dd6))
- permissions for greenkeeper ([#44](https://github.com/interledgerjs/interledgerjs/issues/44)) ([fd3e760](https://github.com/interledgerjs/interledgerjs/commit/fd3e760))
- README badges ([b504caf](https://github.com/interledgerjs/interledgerjs/commit/b504caf))
- revert version changes ([ed195bd](https://github.com/interledgerjs/interledgerjs/commit/ed195bd))
- **ci:** correct package name ([f907883](https://github.com/interledgerjs/interledgerjs/commit/f907883))
- **ci:** fix ci errors ([10dd0ec](https://github.com/interledgerjs/interledgerjs/commit/10dd0ec))

### Features

- (de)serialize ilp errors ([4cd5b2a](https://github.com/interledgerjs/interledgerjs/commit/4cd5b2a))
- add codecs for ilp fulfillment packets ([1176ff0](https://github.com/interledgerjs/interledgerjs/commit/1176ff0))
- add convenience functions for typescript ([8e9de1c](https://github.com/interledgerjs/interledgerjs/commit/8e9de1c))
- add error classes ([35029ba](https://github.com/interledgerjs/interledgerjs/commit/35029ba))
- add ilp rejection packet (error v2) ([704f46f](https://github.com/interledgerjs/interledgerjs/commit/704f46f))
- better type checking for deserializeIlpPrepare ([17fd92e](https://github.com/interledgerjs/interledgerjs/commit/17fd92e))
- circleci config ([103594e](https://github.com/interledgerjs/interledgerjs/commit/103594e))
- data should be passed as a buffer ([32b3fe8](https://github.com/interledgerjs/interledgerjs/commit/32b3fe8))
- decode receivedAmount and maximumAmount for F08 rejections ([265e5d3](https://github.com/interledgerjs/interledgerjs/commit/265e5d3))
- implement basic functionality ([68e59ad](https://github.com/interledgerjs/interledgerjs/commit/68e59ad))
- switch prepare to use fixed-length time format ([273dd1f](https://github.com/interledgerjs/interledgerjs/commit/273dd1f))
- type checks and tests ([#52](https://github.com/interledgerjs/interledgerjs/issues/52)) ([1d4cbb1](https://github.com/interledgerjs/interledgerjs/commit/1d4cbb1))
- update to latest proposal ([f288f28](https://github.com/interledgerjs/interledgerjs/commit/f288f28))
- update to latest proposal ([7195ca0](https://github.com/interledgerjs/interledgerjs/commit/7195ca0))

### Performance Improvements

- don't copy envelope contents ([1df2422](https://github.com/interledgerjs/interledgerjs/commit/1df2422))
- read number fields as numbers ([e5d4f11](https://github.com/interledgerjs/interledgerjs/commit/e5d4f11))
- remove extra number encs/decs ([1adc9c4](https://github.com/interledgerjs/interledgerjs/commit/1adc9c4))
- use long for all uint64 ([42e5f7c](https://github.com/interledgerjs/interledgerjs/commit/42e5f7c))

## 3.0.9 (2019-10-08)

### Bug Fixes

- better errors for undefined params ([1530ad2](https://github.com/interledgerjs/interledgerjs/commit/1530ad2))
- ensure that UTC timezone is included in date ([bf7531e](https://github.com/interledgerjs/interledgerjs/commit/bf7531e))
- export interfaces ([80379cd](https://github.com/interledgerjs/interledgerjs/commit/80379cd))
- optional typeString ([ce91dd6](https://github.com/interledgerjs/interledgerjs/commit/ce91dd6))
- permissions for greenkeeper ([#44](https://github.com/interledgerjs/interledgerjs/issues/44)) ([fd3e760](https://github.com/interledgerjs/interledgerjs/commit/fd3e760))
- README badges ([b504caf](https://github.com/interledgerjs/interledgerjs/commit/b504caf))
- revert version changes ([ed195bd](https://github.com/interledgerjs/interledgerjs/commit/ed195bd))
- **ci:** correct package name ([f907883](https://github.com/interledgerjs/interledgerjs/commit/f907883))
- **ci:** fix ci errors ([10dd0ec](https://github.com/interledgerjs/interledgerjs/commit/10dd0ec))

### Features

- (de)serialize ilp errors ([4cd5b2a](https://github.com/interledgerjs/interledgerjs/commit/4cd5b2a))
- add codecs for ilp fulfillment packets ([1176ff0](https://github.com/interledgerjs/interledgerjs/commit/1176ff0))
- add convenience functions for typescript ([8e9de1c](https://github.com/interledgerjs/interledgerjs/commit/8e9de1c))
- add error classes ([35029ba](https://github.com/interledgerjs/interledgerjs/commit/35029ba))
- add ilp rejection packet (error v2) ([704f46f](https://github.com/interledgerjs/interledgerjs/commit/704f46f))
- better type checking for deserializeIlpPrepare ([17fd92e](https://github.com/interledgerjs/interledgerjs/commit/17fd92e))
- circleci config ([103594e](https://github.com/interledgerjs/interledgerjs/commit/103594e))
- data should be passed as a buffer ([32b3fe8](https://github.com/interledgerjs/interledgerjs/commit/32b3fe8))
- decode receivedAmount and maximumAmount for F08 rejections ([265e5d3](https://github.com/interledgerjs/interledgerjs/commit/265e5d3))
- implement basic functionality ([68e59ad](https://github.com/interledgerjs/interledgerjs/commit/68e59ad))
- switch prepare to use fixed-length time format ([273dd1f](https://github.com/interledgerjs/interledgerjs/commit/273dd1f))
- type checks and tests ([#52](https://github.com/interledgerjs/interledgerjs/issues/52)) ([1d4cbb1](https://github.com/interledgerjs/interledgerjs/commit/1d4cbb1))
- update to latest proposal ([f288f28](https://github.com/interledgerjs/interledgerjs/commit/f288f28))
- update to latest proposal ([7195ca0](https://github.com/interledgerjs/interledgerjs/commit/7195ca0))

### Performance Improvements

- don't copy envelope contents ([1df2422](https://github.com/interledgerjs/interledgerjs/commit/1df2422))
- read number fields as numbers ([e5d4f11](https://github.com/interledgerjs/interledgerjs/commit/e5d4f11))
- remove extra number encs/decs ([1adc9c4](https://github.com/interledgerjs/interledgerjs/commit/1adc9c4))
- use long for all uint64 ([42e5f7c](https://github.com/interledgerjs/interledgerjs/commit/42e5f7c))
