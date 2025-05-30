const { GoogleGenAI, Modality } = require('@google/genai');
require('dotenv').config();

const REAL_API_KEY = process.env.GEMINI_API_KEY || 'your-api-key-here';

async function testGeminiLiveAudioDirect() {
  console.log('Testing Gemini Live Audio directly...');
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
        text: `You are a real-time translator. The user will speak in Japanese.
               Please translate their speech into English and output the translated audio.
               Keep translations natural and conversational.`,
      }]
    },
  };

  try {
    console.log('Connecting to Gemini Live API...');
    
    let sessionConnected = false;
    let setupCompleted = false;
    
    const session = await ai.live.connect({
      model,
      callbacks: {
        onopen: () => {
          console.log('Session opened successfully');
          sessionConnected = true;
        },
        onmessage: (message) => {
          console.log('Received message:', JSON.stringify(message, null, 2));
          if (message.setupComplete) {
            console.log('Setup completed!');
            setupCompleted = true;
          }
        },
        onerror: (e) => {
          console.error('Error:', e.message);
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
    
    console.log('Session connected:', sessionConnected);
    console.log('Setup completed:', setupCompleted);
    console.log('Session active:', sessionConnected || setupCompleted);
    
    // Send test audio data
    const testAudioData = new Float32Array(16000); // 1 second of silence at 16kHz
    const pcmData = new Int16Array(testAudioData.length);
    for (let i = 0; i < testAudioData.length; i++) {
      pcmData[i] = 0;
    }
    
    const base64Audio = Buffer.from(pcmData.buffer).toString('base64');
    
    console.log('Sending test audio...');
    session.sendRealtimeInput({
      audio: {
        data: base64Audio,
        mimeType: 'audio/pcm;rate=16000'
      }
    });
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('Closing session...');
    session.close();
    
    console.log('Test completed');
  } catch (error) {
    console.error('Test failed:', error);
    console.error('Error details:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
  }
}

testGeminiLiveAudioDirect().catch(console.error);