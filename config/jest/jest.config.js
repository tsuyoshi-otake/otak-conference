const path = require('path');

module.exports = {
  rootDir: path.resolve(__dirname, '../..'),
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testTimeout: 30000, // Set global timeout to 30 seconds
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@google/genai)/)'
  ],
  testMatch: ['**/tests/unit/**/*.(test|spec).(ts|tsx|js)'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '@google/genai': '<rootDir>/__mocks__/@google/genai.ts',
    './gemini-live-audio': '<rootDir>/__mocks__/gemini-live-audio.ts'
  },
  setupFilesAfterEnv: ['<rootDir>/config/jest/jest.setup.js'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/index.tsx',
  ],
};
