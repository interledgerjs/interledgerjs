# Contributing

Welcome and thanks for deciding to contribute to Interledger.JS. Below are some guidelines and information before you begin.

## Package structure

All source code is expected to be TypeScript and is placed in the `src` folder. Tests are put in the `test` folder.
The NPM package will not contain any TypeScript files (`*.ts`) but will have typings and source maps. A typical project should have the following structure:

```
|-- src
|-- test
|-- package.json
|-- tsconfig.build.json
```

`eslint` is used to lint the entire monorepo. Our rules can be found in the [.eslintrc.js](./.eslintrc.js) file

### Dependencies

The monorepo is set up to use lerna and yarn workspaces. This means that dev dependencies that are shared across all packages are kept in the root `package.json`.
Dependencies can be added to individual packages by using yarn from the monorepo root folder

```sh
yarn workspace <package-name> add <dependency to install>

# Add dev dependency
yarn workspace <package-name> add <dependency to install> --dev
```

## Commit messages

This project makes use of [Conventional Commits](https://www.conventionalcommits.org/). Please scope your commit messages to the package that it concerns e.g. `fix(oer-utils): ...`.
Please make sure that the tests and linter are run before committing.

## Issues and discussions

We welcome bug reports or feature requests. These can be made by opening an issue. Please have a look through the issues list to see if something similar exists before creating a new one.
For discussions and general questions, please join the [interledger](https://communityinviter.com/apps/interledger/interledger-working-groups-slack) slack channel and [Interledger Forum](https://forum.interledger.org/).

## Pull requests

Please ensure that you create a fork from the `master` branch. Please check that the following has been done before submitting the PR:

- Test coverage for what has been added
- Make sure linting passes (`yarn lint:all` run from the project root)
- Make sure everything builds (`yarn build`run from the project root)
- Make sure all tests pass (`yarn test` run from the project root)
