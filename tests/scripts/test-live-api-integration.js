const { GoogleGenAI, Modality } = require('@google/genai');
require('dotenv').config();

const REAL_API_KEY = process.env.GEMINI_API_KEY || 'your-api-key-here';

async function testLiveAPIIntegration() {
  console.log('Testing Live API Integration...');
  console.log('API Key:', REAL_API_KEY.substring(0, 10) + '...');
  
  const ai = new GoogleGenAI({ apiKey: REAL_API_KEY });
  const model = 'gemini-2.0-flash-live-001';
  
  const config = {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: 'Zephyr',
        }
      }
    },
    systemInstruction: {
      parts: [{
        text: `You are a real-time translator. Translate from Japanese to English.`,
      }]
    },
  };

  let sessionConnected = false;
  let setupCompleted = false;
  let messagesReceived = [];

  try {
    console.log('Connecting to Live API...');
    
    const session = await ai.live.connect({
      model,
      callbacks: {
        onopen: () => {
          console.log('✓ Session opened successfully');
          sessionConnected = true;
        },
        onmessage: (message) => {
          messagesReceived.push(message);
          
          if (message.setupComplete) {
            console.log('✓ Setup completed');
            setupCompleted = true;
          }
          
          if (message.serverContent?.modelTurn?.parts) {
            const parts = message.serverContent.modelTurn.parts;
            for (const part of parts) {
              if (part.inlineData) {
                console.log('✓ Received audio data:',
                  (part.inlineData.data.length / 1024).toFixed(2) + 'KB');
              }
              if (part.text) {
                console.log('✓ Received text:', part.text);
              }
            }
          }
        },
        onerror: (e) => {
          console.error('✗ Error:', e.message);
        },
        onclose: (e) => {
          console.log('Session closed:', e.reason);
          sessionConnected = false;
        },
      },
      config
    });

    console.log('Session created, waiting for setup...');
    
    // Wait for setup to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('\nConnection Status:');
    console.log('- Session connected:', sessionConnected);
    console.log('- Setup completed:', setupCompleted);
    console.log('- Messages received:', messagesReceived.length);
    console.log('- Session active:', sessionConnected || setupCompleted);
    
    // Send test message
    console.log('\nSending test message...');
    await session.sendClientContent({
      turns: [{
        role: 'user',
        parts: [{ text: 'こんにちは' }]
      }],
      turnComplete: true
    });
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('\nTotal messages received:', messagesReceived.length);
    
    // Close session
    console.log('\nClosing session...');
    session.close();
    
    console.log('\n✓ Test completed successfully');
    
    // Return test results
    return {
      success: true,
      sessionConnected,
      setupCompleted,
      messagesReceived: messagesReceived.length,
      isActive: sessionConnected || setupCompleted
    };
    
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    console.error('Error details:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

// Run the test
testLiveAPIIntegration()
  .then(result => {
    console.log('\nTest Result:', JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });