# Interledger.JS Monorepo
[![](https://github.com/interledgerjs/interledgerjs/workflows/Build-Publish/badge.svg)](https://github.com/interledgerjs/interledgerjs/actions)
> This is a WIP and will ultimately replace a number of stand-alone modules

## Background

Interledger.JS has a long history of modules that have been added as experiments and abandoned or deprecated and replaced by new versions or alternatives. Since late 2018 a few key modules have stabilized and become key dependencies for various others.

For [a while](https://forum.interledger.org/t/interledgerjs-monorepo/318) the community has been keen to put many of the core modules into a single monorepo. The current packages included are:
  1. [ilp-logger](./packages/ilp-logger/README.md)
  2. [ilp-packet](./packages/ilp-packet/README.md)
  3. [ilp-protocol-ccp](./packages/ilp-protocol-ccp/README.md)
  4. [ilp-protocol-ildcp](./packages/ilp-protocol-ildcp/README.md)
  5. [oer-utils](./packages/oer-utils/README.md)

## Installation
The monorepo is set up to use lerna and yarn workspaces. To get started run the following:
  1. yarn install - Yarn will install the dependencies and do the necessary linking. So no need to run `lerna bootstrap`.
  2. yarn build
  3. yarn test - This will run the tests in all the packages.

### Running script commands
Script commands such as `test` and `lint` can be run from the root of the project by running 
```sh
# All tests in all packages
yarn test

#Scoping to a package
yarn test --scope=packages/<package-name>
```

or in the package directory
```sh
yarn test
```

If you are interested in contributing, please read the [contributing guidelines](./CONTRIBUTING.md).

## Note to maintainers: Versioning

Independent versioning is used for this project and releases can only be made from `master`.
The following steps are used to create a release:
  1. Make sure you are up to date with master.
  2. Run `lerna version` and follow the command prompts. This will commit the package version changes and create the necessary tags - all of which will be pushed to master.
