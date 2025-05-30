import { RoomDurableObject } from './room-handler.js';

export { RoomDurableObject };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // WebSocket upgrade for signaling
    if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') {
      // Get or create a room
      const roomId = url.searchParams.get('room') || 'default';
      const roomIdObj = env.ROOMS.idFromName(roomId);
      const room = env.ROOMS.get(roomIdObj);
      
      return room.fetch(request);
    }
    
    // API endpoint for health check
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }
    
    return new Response('WebSocket Signaling Server - Ready for CI/CD', { status: 200 });
  }
};
