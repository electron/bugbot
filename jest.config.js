process.env.SPEC_RUNNING = '1';

module.exports = {
  clearMocks: true,
  collectCoverageFrom: ['<rootDir>/modules/*/src/**/*ts'],
  coverageDirectory: '<rootDir>/coverage/',
  preset: 'ts-jest',
  projects: [
    '<rootDir>/modules/bot/',
    '<rootDir>/modules/broker/',
    '<rootDir>/integration-tests',
  ],
};
