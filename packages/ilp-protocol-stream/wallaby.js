module.exports = function (w) {
  return {
    files: [
      'src/**/*.ts',
      'test/mocks/*.ts'
    ],

    tests: [
      'test/**/*.test.ts'
    ],

    env: {
      type: 'node'
    }
  }
}
