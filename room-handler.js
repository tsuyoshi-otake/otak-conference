// Durable Object for managing WebRTC signaling rooms
export class RoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request) {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    await this.handleSession(server);
    
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async handleSession(webSocket) {
    webSocket.accept();
    
    let sessionId = null;
    
    webSocket.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'join':
            // Check if room is already at maximum capacity (2 participants)
            if (this.sessions.size >= 2) {
              // Room is full, reject the new participant
              webSocket.send(JSON.stringify({
                type: 'room-full',
                message: 'This conference room is full. Maximum 2 participants allowed.',
                maxParticipants: 2,
                currentParticipants: this.sessions.size
              }));
              webSocket.close();
              return;
            }
            
            sessionId = data.clientId;
            this.sessions.set(sessionId, {
              webSocket,
              username: data.username,
              language: data.language,
              clientId: data.clientId
            });
            
            // Send current participants list to new user
            const participants = Array.from(this.sessions.entries())
              .map(([id, session]) => ({
                clientId: session.clientId,
                username: session.username,
                language: session.language
              }));
            
            webSocket.send(JSON.stringify({
              type: 'participants',
              participants: participants
            }));
            
            // Notify all other users about new participant
            this.broadcast({
              type: 'user-joined',
              peerId: data.clientId,
              username: data.username,
              language: data.language
            }, sessionId);
            break;
            
          case 'offer':
          case 'answer':
          case 'ice-candidate':
            // Forward WebRTC signaling messages to target
            const targetSession = Array.from(this.sessions.values())
              .find(session => session.clientId === data.peerId);
            
            if (targetSession) {
              targetSession.webSocket.send(JSON.stringify({
                type: data.type,
                peerId: sessionId,
                offer: data.offer,
                answer: data.answer,
                candidate: data.candidate
              }));
            }
            break;
          case 'hand-raise':
          case 'reaction':
          case 'chat':
          case 'message-read':
          case 'speaking-status':
          case 'translated-audio':
          case 'translation':
            // Broadcast hand raise, reaction, chat message, read notification, speaking status, translated audio, or translation to all participants
            this.broadcast({
              ...data,
              fromId: sessionId
            }, null); // Send to all including sender for consistency
            break;
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });
    
    webSocket.addEventListener('close', () => {
      if (sessionId) {
        this.sessions.delete(sessionId);
        this.broadcast({
          type: 'user-left',
          peerId: sessionId
        }, sessionId);
      }
    });
    
    webSocket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      if (sessionId) {
        this.sessions.delete(sessionId);
      }
    });
  }

  broadcast(message, excludeId = null) {
    const messageStr = JSON.stringify(message);
    
    this.sessions.forEach((session, id) => {
      if (id !== excludeId) {
        try {
          session.webSocket.send(messageStr);
        } catch (error) {
          console.error('Broadcast error:', error);
          this.sessions.delete(id);
        }
      }
    });
  }
}