# Interledger.js Monorepo

[![GitHub Actions](https://img.shields.io/github/workflow/status/interledgerjs/interledgerjs/master.svg?style=flat&logo=github)](https://circleci.com/gh/interledgerjs/interledgerjs/master)
[![codecov](https://codecov.io/gh/interledgerjs/interledgerjs/branch/master/graph/badge.svg)](https://codecov.io/gh/interledgerjs/interledgerjs)

## Packages

### Payments

| Name                                                         | Version                                                                                                                                                     | Description                                   |
| :----------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------- |
| [`@interledger/pay`](./packages/pay)                         | [![NPM Package](https://img.shields.io/npm/v/@interledger/pay.svg?style=flat&logo=npm)](https://npmjs.org/package/@interledger/pay)                         | Send payments over Interledger using STREAM   |
| [`@interledger/stream-receiver`](./packages/stream-receiver) | [![NPM Package](https://img.shields.io/npm/v/@interledger/stream-receiver.svg?style=flat&logo=npm)](https://npmjs.org/package/@interledger/stream-receiver) | Simple & composable stateless STREAM receiver |

### Utilities

| Name                                                  | Version                                                                                                                                 | Description                                                |
| :---------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------- |
| [`ilp-logger`](./packages/ilp-logger)                 | [![NPM Package](https://img.shields.io/npm/v/ilp-logger.svg?style=flat&logo=npm)](https://npmjs.org/package/ilp-logger)                 | Debug logging utility for Interledger modules              |
| [`ilp-packet`](./packages/ilp-packet)                 | [![NPM Package](https://img.shields.io/npm/v/ilp-packet.svg?style=flat&logo=npm)](https://npmjs.org/package/ilp-packet)                 | Serialization/deserialization utility for ILP packets      |
| [`ilp-plugin`](./packages/ilp-plugin)                 | [![NPM Package](https://img.shields.io/npm/v/ilp-plugin.svg?style=flat&logo=npm)](https://npmjs.org/package/ilp-plugin)                 | Connect to a local, open BTP server                        |
| [`ilp-protocol-ccp`](./packages/ilp-protocol-ccp)     | [![NPM Package](https://img.shields.io/npm/v/ilp-protocol-ccp.svg?style=flat&logo=npm)](https://npmjs.org/package/ilp-protocol-ccp)     | Serialization/deserialization for the CCP routing protocol |
| [`ilp-protocol-ildcp`](./packages/ilp-protocol-ildcp) | [![NPM Package](https://img.shields.io/npm/v/ilp-protocol-ildcp.svg?style=flat&logo=npm)](https://npmjs.org/package/ilp-protocol-ildcp) | Fetch asset and account details from a parent              |
| [`oer-utils`](./packages/oer-utils)                   | [![NPM Package](https://img.shields.io/npm/v/oer-utils.svg?style=flat&logo=npm)](https://npmjs.org/package/oer-utils)                   | Tools for OER parsing and serialization                    |

## Installation

The monorepo is set up to use lerna and yarn workspaces. To get started run the following:

1. `yarn install` - Yarn will install the dependencies and do the necessary linking (no need to run `lerna bootstrap`).
2. `yarn build`
3. `yarn test` - This will run the tests in all the packages.

### Running script commands

Script commands such as `test` and `lint` can be run from the root of the project by running:

```sh
# Run tests for all packages
yarn test

# Run tests for a specific module a package
yarn test --scope=<package-name>
```

Or in the package directory:

```sh
yarn test
```

If you are interested in contributing, please read the [contributing guidelines](./CONTRIBUTING.md).

## For Maintainers

### Versioning

Independent versioning is used for this project and releases can only be made from `master`. You will need to set the `GH_TOKEN` env variable to your
personal [GitHub access token](https://github.com/settings/tokens). Please make sure that you are up to date with master and that the tests and linting pass. Then use the following to create a release:

```sh
# On master
GH_TOKEN=<github-token> lerna version --conventional-commits --create-release github
```

and follow the command prompts. This will commit the package version changes and create the necessary tags - all of which will be pushed to master. It will also create changelogs and official GitHub releases.

If you want to release an `alpha` then run

```sh
# On master
GH_TOKEN=<github-token> lerna version --conventional-commits --conventional-prerelease --create-release github
```

This will append `-alpha.<alpha-version>` to the release name. The alpha release can be graduated (`1.0.1-alpha.1` => `1.0.1`) by running:

```sh
# On master
GH_TOKEN=<github-token> lerna version --conventional-commits --conventional-graduate --create-release github
```

### Adding new packages

All source code is expected to be TypeScript and is placed in the `src` folder. Tests are put in the `test` folder.
The NPM package will not contain any TypeScript files (`*.ts`) but will have typings and source maps. A typical project should have the following structure:

```
|-- src
|-- test
|-- package.json
|-- tsconfig.build.json
```

The `tsconfig.build.json` file should have the following

```js
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "baseUrl": ".",
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "./dist/tsconfig.build.tsbuildinfo"
  },
  "include": [
    "src"
  ]
}
```

The `package.json` file should specify the following

```js
{
  "name": "<package-name>",
  "license": "Apache-2.0",
  "publishConfig": {
    "access": "public"
  }
}
```

In the `scripts` section of the `package.json`, be sure to have `build`, `cover` (which runs tests with coverage) and `codecov`. These will be called from the CI pipeline. Please use the following as a guideline:

```js
"scripts": {
  "build": "tsc -p tsconfig.build.json",
  "cover": "...",
  "codecov": "codecov --root=../../ -f coverage/*.json -F <flagname>"
}
```

The `cover` script should run the tests with code coverage and output the coverage results in a format that can be uploaded to codecov. The `flagname` will be used by codecov to track coverage per package. Please make sure it matches the regex `^[a-z0-9_]{1,45}$`.

### Importing legacy modules

This process preserves the commit history of the legacy modules.

```sh
git clone git@github.com:adrianhopebailie/interledgerjs.git
git clone git@github.com:interledgerjs/legacy-module.git
cd legacy-module
git pull
cd ../interledgerjs
lerna import ../legacy-module --dest=packages --preserve-commit --flatten
```

You then need to replace the `tsconfig.json` file with the `tsconfig.build.json` and update the `package.json` as described above.

### Dependencies

We keep devDependencies that are shared across all packages in the root `package.json` file. Dependencies can be added to individual packages using Lerna

```sh
lerna add <package to install> --scope=<package-name>

# Add dev dependency
lerna add <package to install> --scope=<package-name> --dev
```

### Running script commands

Script commands such as `test` and `lint` can be run from the root of the project by running

```sh
# All tests in all packages
lerna run test

#Scoping to a package
lerna run test --scope=<package-name>
```
