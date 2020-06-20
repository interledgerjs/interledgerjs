module.exports = {
  collectCoverageFrom: [
    'src/**/*.ts',
    '!**/node_modules/**',
    // Exclude unused functionality
    '!src/rates/ecb.ts',
    '!src/controllers/liquidity-congestion.ts'
  ],
  coverageDirectory: 'coverage',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/dist']
}
