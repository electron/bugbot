process.env.SPEC_RUNNING = '1';

module.exports = {
  clearMocks: true,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  preset: 'ts-jest',
  roots: [
    '<rootDir>/integration-tests',
    '<rootDir>/modules/bot',
    '<rootDir>/modules/broker',
    '<rootDir>/modules/runner',
    '<rootDir>/modules/shared',
  ],
  testRegex: '(/spec/.*|(\\.|/)(test|spec))\\.tsx?$',
};
