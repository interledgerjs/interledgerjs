module.exports = function (wallaby) {
  return {
    files: [
      'src/**/*.ts',
      '*.js'
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
