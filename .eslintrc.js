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
      './integration-tests/tsconfig.json',
      './modules/bot/tsconfig.eslint.json',
      './modules/broker/tsconfig.eslint.json',
      './modules/runner/tsconfig.eslint.json',
      './modules/shared/tsconfig.eslint.json',
      './tsconfig.json',
    ],
    sourceType: 'module',
    tsconfigRootDir: __dirname,
  },
  rules: {
    // TODO(anyone): re-enable any of these tests & fix the warnings
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-misused-promises': 'off',
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',
    '@typescript-eslint/restrict-template-expressions': 'off',

    // a la carte warnings
    'no-template-curly-in-string': 'error',
  }
}

module.exports = config;
