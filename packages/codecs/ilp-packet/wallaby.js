module.exports = function (wallaby) {
  return {
    files: [
      'src/**/*.js',
      'test/helpers/*.js',
      'test/data/**/*.json',
      'index.js'
    ],

    tests: [
      'test/*Spec.js'
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
