const config = {
  env: {
    node: true
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:prettier/recommended'
  ],
  ignorePatterns: ['.eslintrc.js', 'jest.config.js'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    project: [
      './integration-tests/tsconfig.eslint.json',
      './modules/issue-manager/tsconfig.eslint.json',
      './modules/broker/tsconfig.eslint.json',
      './modules/runner/tsconfig.eslint.json',
      './modules/shared/tsconfig.eslint.json',
      './tsconfig.json',
    ],
    sourceType: 'module',
    tsconfigRootDir: __dirname,
  },
  rules: {
    // a la carte warnings
    'no-template-curly-in-string': 'error',
  }
}

module.exports = config;
