const { GoogleGenAI, Modality } = require('@google/genai');
require('dotenv').config();

const REAL_API_KEY = process.env.GEMINI_API_KEY || 'your-api-key-here';

async function testGeminiLiveAPI() {
  console.log('Testing Gemini Live API with real API key...');
  console.log('API Key:', REAL_API_KEY.substring(0, 10) + '...');
  
  const ai = new GoogleGenAI({ apiKey: REAL_API_KEY });
  const model = 'gemini-2.0-flash-live-001';
  const config = { 
    responseModalities: [Modality.TEXT],
    systemInstruction: {
      parts: [{
        text: 'You are a real-time translator. Translate from Japanese to English.'
      }]
    }
  };

  try {
    console.log('Connecting to Gemini Live API...');
    
    const session = await ai.live.connect({
      model: model,
      callbacks: {
        onopen: function () {
          console.log('Connection opened successfully');
        },
        onmessage: function (message) {
          console.log('Received message:', JSON.stringify(message, null, 2));
        },
        onerror: function (e) {
          console.error('Error:', e.message);
        },
        onclose: function (e) {
          console.log('Connection closed:', e.reason);
        },
      },
      config: config,
    });

    console.log('Session created, sending test message...');
    
    // Send a test message
    session.sendClientContent({ 
      turns: [{
        role: 'user',
        parts: [{ text: 'こんにちは、元気ですか？' }]
      }]
    });

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('Closing session...');
    session.close();
    
    console.log('Test completed successfully');
  } catch (error) {
    console.error('Test failed:', error);
    console.error('Error details:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
  }
}

// Test with audio
async function testGeminiLiveAudioAPI() {
  console.log('\n\nTesting Gemini Live API with Audio...');
  
  const ai = new GoogleGenAI({ apiKey: REAL_API_KEY });
  const model = 'gemini-2.0-flash-live-001';
  const config = { 
    responseModalities: [Modality.AUDIO],
    speechConfig: { 
      voiceConfig: { 
        prebuiltVoiceConfig: { 
          voiceName: 'Zephyr' 
        } 
      } 
    }
  };

  try {
    console.log('Connecting to Gemini Live API for audio...');
    
    const session = await ai.live.connect({
      model: model,
      callbacks: {
        onopen: function () {
          console.log('Audio connection opened successfully');
        },
        onmessage: function (message) {
          if (message.serverContent?.modelTurn?.parts) {
            const parts = message.serverContent.modelTurn.parts;
            for (const part of parts) {
              if (part.inlineData) {
                console.log('Received audio data:',
                  (part.inlineData.data.length / 1024).toFixed(2) + 'KB',
                  'MIME:', part.inlineData.mimeType);
              }
            }
          }
        },
        onerror: function (e) {
          console.error('Audio Error:', e.message);
        },
        onclose: function (e) {
          console.log('Audio connection closed:', e.reason);
        },
      },
      config: config,
    });

    console.log('Audio session created, sending test message...');
    
    // Send a test message
    session.sendClientContent({ 
      turns: [{
        role: 'user',
        parts: [{ text: 'Hello, how are you?' }]
      }]
    });

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('Closing audio session...');
    session.close();
    
    console.log('Audio test completed successfully');
  } catch (error) {
    console.error('Audio test failed:', error);
    console.error('Error details:', error.message);
  }
}

// Run tests
async function runAllTests() {
  await testGeminiLiveAPI();
  await testGeminiLiveAudioAPI();
}

runAllTests().catch(console.error);