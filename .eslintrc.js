module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended', // Uses the recommended rules from the @typescript-eslint/eslint-plugin
    'prettier', // Uses eslint-config-prettier to disable ESLint rules from @typescript-eslint/eslint-plugin that would conflict with prettier
    'plugin:prettier/recommended', // Enables eslint-plugin-prettier and eslint-config-prettier. This will display prettier errors as ESLint errors. Make sure this is always the last configuration in the extends array.
  ],
  plugins: ['@typescript-eslint', 'jest'],
  env: {
    es6: true,
    node: true,
    mocha: true,
  },
  parserOptions: {
    ecmaVersion: 2017,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  rules: {
    '@typescript-eslint/no-empty-interface': ['off'],
    '@typescript-eslint/no-unused-vars': [
      'warn', // or error
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
  },
  globals: {
    BigInt: 'readable',
  },
  ignorePatterns: ['**/node_modules/**/*', '**/dist/**/*', '**/*.config.js', '**/.*.js'],
  overrides: [
    {
      files: ['**/*.spec.ts'],
      rules: {
        // In test code, it's often useful to explicitly disable typing so we don't want to be
        // warned about using 'any' or @ts-ignore comments.
        '@typescript-eslint/no-explicit-any': ['off'],
        '@typescript-eslint/ban-ts-comment': ['off'],
        '@typescript-eslint/no-non-null-assertion': ['off'],
      },
    },
  ],
}
