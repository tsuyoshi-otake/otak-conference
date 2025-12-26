// API integration test setup
// This file is run before API tests to set up the environment

// Set longer timeout for API calls
jest.setTimeout(30000);

// Global error handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});