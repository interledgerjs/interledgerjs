module.exports = {
  collectCoverageFrom: [
    'src/**/*.ts',
    '!**/node_modules/**',
    '!src/utils.ts' // TODO remove this!
  ],
  coverageReporters: ['text', 'lcov'],
  coverageDirectory: 'coverage',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/dist']
}
