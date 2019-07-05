# Interledger.JS Monorepo

> This is a WIP and will ultimately replace a number of stand-alone modules

## Background

Interledger.JS has a long history of modules that have been added as experiments and abandoned or deprecated and replaced by new versions or alternatives. Since late 2018 a few key modules have stabilized and become key dependencies for various others.

For [a while](https://forum.interledger.org/t/interledgerjs-monorepo/318) the community has been keen to put many of the core modules into a single monorepo.

## Design Decisions

 - Keep it simple. Minimal custom stuff
 - Use the @interledger scope and new package names to allow for some refactoring to do away with legacy hacks
 - Switch to synchronized versioning

## Process

 1. Setup a monorepo framework with a few small modules
 2. [Import](#importing) existing modules one by one and deprecate the old module
 3. Rename the module to fit the new structure and naming
 4. Update the new package to use the same build, test and linting scripts as others
 5. Remove dev dependencies
 6. Update dependencies and imports to use new module names
 7. Fix linting or build errors

## Importing

This process preserves the commit history of the legacy modules.
(This assume the module being imported should go into `protocols`, as opposed to a `codecs` or `utils`)

```sh
git clone git@github.com:adrianhopebailie/interledgerjs.git
git clone git@github.com:interledgerjs/legacy-module.git
cd legacy-module
git pull
cd ../interledgerjs
lerna import ../legacy-module --dest=packages/protocols --preserve-commit --flatten
```
 