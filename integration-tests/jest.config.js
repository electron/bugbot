process.env.SPEC_RUNNING = '1';

module.exports = {
  clearMocks: true,
  preset: 'ts-jest',
  rootDir: `${__dirname}/..`,
  roots: [`${__dirname}/test`],
  testMatch: ['**/*.(spec|test).ts'],
};
