/**
 * Integration tests for deployed Cloudflare Worker API
 * Tests the actual deployed endpoints on otak-conference-worker.systemexe-research-and-development.workers.dev
 */

const fetch = require('node-fetch');

const WORKER_URL = 'https://otak-conference-worker.systemexe-research-and-development.workers.dev';

describe('Cloudflare Worker API Integration Tests', () => {
  
  describe('Health Check Endpoint', () => {
    test('GET /health should return OK', async () => {
      const response = await fetch(`${WORKER_URL}/health`);
      
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('OK');
    });

    test('Health endpoint should have correct headers', async () => {
      const response = await fetch(`${WORKER_URL}/health`);
      
      expect(response.headers.get('content-type')).toContain('text/plain');
    });
  });

  describe('Root Endpoint', () => {
    test('GET / should return welcome message', async () => {
      const response = await fetch(WORKER_URL);
      
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('WebSocket Signaling Server - Ready for CI/CD');
    });

    test('Root endpoint should accept different HTTP methods', async () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE'];
      
      for (const method of methods) {
        const response = await fetch(WORKER_URL, { method });
        expect(response.status).toBe(200);
      }
    });
  });

  describe('WebSocket Endpoint', () => {
    test('Non-WebSocket request to /ws should return default response', async () => {
      const response = await fetch(`${WORKER_URL}/ws`);
      
      // Should return default response since no WebSocket upgrade header
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('WebSocket Signaling Server - Ready for CI/CD');
    });

    test('WebSocket endpoint should accept room parameter', async () => {
      const response = await fetch(`${WORKER_URL}/ws?room=test-room`);
      
      // Without WebSocket headers, should return default response
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('WebSocket Signaling Server - Ready for CI/CD');
    });
  });

  describe('Error Handling', () => {
    test('Non-existent endpoint should return default response', async () => {
      const response = await fetch(`${WORKER_URL}/non-existent`);
      
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('WebSocket Signaling Server - Ready for CI/CD');
    });

    test('Invalid WebSocket request should be handled gracefully', async () => {
      const response = await fetch(`${WORKER_URL}/ws`, {
        headers: {
          'Upgrade': 'invalid',
        }
      });
      
      expect(response.status).toBe(200);
    });
  });

  describe('Performance Tests', () => {
    test('Health check should respond quickly', async () => {
      const startTime = Date.now();
      const response = await fetch(`${WORKER_URL}/health`);
      const endTime = Date.now();
      
      expect(response.status).toBe(200);
      expect(endTime - startTime).toBeLessThan(5000); // Should respond within 5 seconds
    });

    test('Multiple concurrent requests should be handled', async () => {
      const requests = Array(10).fill().map(() => 
        fetch(`${WORKER_URL}/health`)
      );
      
      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe('CORS and Headers', () => {
    test('Should handle CORS preflight requests', async () => {
      const response = await fetch(WORKER_URL, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        }
      });
      
      // Should handle OPTIONS request
      expect([200, 204].includes(response.status)).toBe(true);
    });

    test('Should have security headers', async () => {
      const response = await fetch(`${WORKER_URL}/health`);
      
      // Check for basic security considerations
      expect(response.headers.get('x-powered-by')).toBeNull();
    });
  });

  describe('Durable Objects Integration', () => {
    test('Different room IDs should be handled by the worker', async () => {
      const room1Response = await fetch(`${WORKER_URL}/ws?room=room1`);
      const room2Response = await fetch(`${WORKER_URL}/ws?room=room2`);
      
      // Both should return the default response (no WebSocket upgrade)
      expect(room1Response.status).toBe(200);
      expect(room2Response.status).toBe(200);
      expect(await room1Response.text()).toBe('WebSocket Signaling Server - Ready for CI/CD');
      expect(await room2Response.text()).toBe('WebSocket Signaling Server - Ready for CI/CD');
    });

    test('Default room should be used when no room specified', async () => {
      const response = await fetch(`${WORKER_URL}/ws`);
      
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('WebSocket Signaling Server - Ready for CI/CD');
    });
  });
});