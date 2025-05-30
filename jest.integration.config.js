module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testTimeout: 60000, // Set global timeout to 60 seconds
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
    '^.+\\.mjs$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@google/genai)/)'
  ],
  testMatch: [
    '**/tests/integration/**/*.test.(ts|tsx|js)',
    '**/tests/integration/**/*.integration.test.(ts|tsx|js)'
  ],
  // No moduleNameMapper - use actual modules for integration tests
  setupFilesAfterEnv: ['<rootDir>/jest.integration.setup.js'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/index.tsx',
  ],
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
};