module.exports = {
  testEnvironment: 'node',
  moduleFileExtensions: ['js'],
  transform: {},
  testMatch: ['**/api-integration.test.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.api.setup.js'],
  testTimeout: 30000, // 30 seconds for API calls
};