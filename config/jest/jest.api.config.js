const path = require('path');

module.exports = {
  rootDir: path.resolve(__dirname, '../..'),
  testEnvironment: 'node',
  moduleFileExtensions: ['js'],
  transform: {},
  testMatch: ['**/tests/integration/api-integration.test.js'],
  setupFilesAfterEnv: ['<rootDir>/config/jest/jest.api.setup.js'],
  testTimeout: 30000, // 30 seconds for API calls
};
