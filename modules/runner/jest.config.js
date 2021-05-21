process.env.SPEC_RUNNING = '1';

module.exports = {
  clearMocks: true,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  preset: 'ts-jest',
  roots: ['<rootDir>/test'],
  testRegex: '(/spec/.*|(\\.|/)(test|spec))\\.tsx?$',
};
