module.exports = {
  collectCoverageFrom: [
    'src/**/*.ts',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/dist']
}
