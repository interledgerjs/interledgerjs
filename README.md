# Interledger.JS Monorepo
[![](https://github.com/interledgerjs/interledgerjs/workflows/master/badge.svg)](https://github.com/interledgerjs/interledgerjs/actions)
[![codecov](https://codecov.io/gh/interledgerjs/interledgerjs/branch/master/graph/badge.svg)](https://codecov.io/gh/interledgerjs/interledgerjs)
> This is a WIP and will ultimately replace a number of stand-alone modules

## Background

Interledger.JS has a long history of modules that have been added as experiments and abandoned or deprecated and replaced by new versions or alternatives. Since late 2018 a few key modules have stabilized and become key dependencies for various others.

For [a while](https://forum.interledger.org/t/interledgerjs-monorepo/318) the community has been keen to put many of the core modules into a single monorepo. The current packages included are:
  1. [ilp-logger](./packages/ilp-logger/README.md)
  2. [ilp-packet](./packages/ilp-packet/README.md)
  3. [ilp-plugin](./packages/ilp-plugin/README.md)
  4. [ilp-protocol-ccp](./packages/ilp-protocol-ccp/README.md)
  5. [ilp-protocol-ildcp](./packages/ilp-protocol-ildcp/README.md)
  6. [ilp-spsp-payout](./packages/ilp-spsp-payout/README.md)
  7. [oer-utils](./packages/oer-utils/README.md)

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
yarn test --scope=<package-name>
```

or in the package directory
```sh
yarn test
```

If you are interested in contributing, please read the [contributing guidelines](./CONTRIBUTING.md).

## Note to maintainers: 
### Versioning

Independent versioning is used for this project and releases can only be made from `master`. You will need to set the `GH_TOKEN` env variable to your 
personal [github access token](https://github.com/settings/tokens). Please make sure that you are up to date with master and that the tests and linting pass. Then use the following to create a release: 
```sh
# On master
GH_TOKEN=<github-token> lerna version --conventional-commits --create-release github
``` 
and follow the command prompts. This will commit the package version changes and create the necessary tags - all of which will be pushed to master. It will also create changelogs and official github releases.

If you want to release an `alpha` then run
```sh
# On master
GH_TOKEN=<github-token> lerna version --conventional-commits --conventional-prerelease --create-release github
```
This will append `-alpha.<alpha-version>` to the release name. The alpha release can be graduated (`1.0.1-alpha.1` => `1.0.1`) by running
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
