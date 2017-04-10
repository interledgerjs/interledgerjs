module.exports = function (wallaby) {
  return {
    files: [
      'src/**/*.ts',
      'test/helpers/*.ts',
      'test/data/**/*.json',
      'index.ts'
    ],

    tests: [
      'test/*.spec.ts'
    ],

    testFramework: 'mocha',

    env: {
      type: 'node',
      runner: 'node',
      params: {
        env: 'NODE_ENV=unit'
      }
    }
  }
}
