module.exports = {
  ...require('./jest.config'),
  testMatch: ['**/__tests__/**/*.integration.ts', '**/?(*.)+(integration).ts'],
  testTimeout: 30000,
};
