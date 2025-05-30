const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const REAL_API_KEY = process.env.GEMINI_API_KEY || 'your-api-key-here';

async function testGeminiTTS() {
  console.log('Testing Gemini TTS API...');
  console.log('API Key:', REAL_API_KEY.substring(0, 10) + '...');
  
  const ai = new GoogleGenAI({ apiKey: REAL_API_KEY });

  try {
    console.log('Generating TTS audio...');
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: 'Say cheerfully: Have a wonderful day!' }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    console.log('Response received:', response);
    
    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (data) {
      console.log('Audio data received, size:', (data.length / 1024).toFixed(2) + 'KB');
      console.log('Test successful!');
    } else {
      console.log('No audio data in response');
    }
    
  } catch (error) {
    console.error('Test failed:', error);
    console.error('Error details:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testGeminiTTS().catch(console.error);