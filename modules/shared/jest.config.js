process.env.SPEC_RUNNING = '1';

module.exports = {
  clearMocks: true,
  coveragePathIgnorePatterns: ['/node_modules/', '<rootDir>/modules/*/build'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  preset: 'ts-jest',
  roots: ['<rootDir>/test'],
  testRegex: '(/spec/.*|(\\.|/)(test|spec))\\.tsx?$',
};
