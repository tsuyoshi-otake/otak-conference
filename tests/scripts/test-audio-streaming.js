const { GoogleGenAI, Modality } = require('@google/genai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const REAL_API_KEY = process.env.GEMINI_API_KEY || 'your-api-key-here';

async function testAudioStreaming() {
  console.log('Testing Gemini Live API Audio Streaming...');
  
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
    },
    systemInstruction: {
      parts: [{
        text: 'You are a helpful assistant. Respond in a friendly tone.'
      }]
    }
  };

  let audioChunks = [];
  
  try {
    console.log('Connecting to Gemini Live API...');
    
    const session = await ai.live.connect({
      model: model,
      callbacks: {
        onopen: function () {
          console.log('Connection opened successfully');
        },
        onmessage: function (message) {
          if (message.serverContent?.modelTurn?.parts) {
            const parts = message.serverContent.modelTurn.parts;
            for (const part of parts) {
              if (part.inlineData && part.inlineData.data) {
                const audioData = Buffer.from(part.inlineData.data, 'base64');
                audioChunks.push(audioData);
                console.log(`Received audio chunk: ${(audioData.length / 1024).toFixed(2)}KB`);
                
                // Check first few bytes
                const firstBytes = audioData.slice(0, 8);
                console.log(`   First 8 bytes: ${Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
              }
            }
          }
          
          if (message.serverContent?.turnComplete) {
            console.log('Turn complete');
          }
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

    console.log('Sending test message...');
    
    // Send a test message
    session.sendClientContent({ 
      turns: [{
        role: 'user',
        parts: [{ text: 'Please say "Hello, this is a test of the Gemini Live Audio API"' }]
      }]
    });

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 8000));

    console.log('Closing session...');
    session.close();
    
    // Combine audio chunks
    if (audioChunks.length > 0) {
      const totalAudio = Buffer.concat(audioChunks);
      console.log(`\nAudio Statistics:`);
      console.log(`Total chunks: ${audioChunks.length}`);
      console.log(`Total size: ${(totalAudio.length / 1024).toFixed(2)}KB`);
      console.log(`Duration (estimated): ${(totalAudio.length / (24000 * 2)).toFixed(2)}s`);
      
      // Save as raw PCM
      fs.writeFileSync('test-output.pcm', totalAudio);
      console.log('Saved to: test-output.pcm');
      
      // Create WAV file
      const wavBuffer = createWavFromPcm(totalAudio);
      fs.writeFileSync('test-output.wav', wavBuffer);
      console.log('Saved to: test-output.wav');
      
      // Verify files were created
      verifyOutputFiles();
    }
    
    console.log('\nAudio streaming test completed successfully');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

function createWavFromPcm(pcmData) {
  const pcmLength = pcmData.length;
  const wavBuffer = Buffer.alloc(44 + pcmLength);
  
  // WAV header
  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(36 + pcmLength, 4);
  wavBuffer.write('WAVE', 8);
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16); // fmt chunk size
  wavBuffer.writeUInt16LE(1, 20); // PCM format
  wavBuffer.writeUInt16LE(1, 22); // mono
  wavBuffer.writeUInt32LE(24000, 24); // sample rate (24kHz)
  wavBuffer.writeUInt32LE(24000 * 2, 28); // byte rate
  wavBuffer.writeUInt16LE(2, 32); // block align
  wavBuffer.writeUInt16LE(16, 34); // bits per sample
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(pcmLength, 40);
  
  // Copy PCM data
  pcmData.copy(wavBuffer, 44);
  
  return wavBuffer;
}

// Test with real-time audio input simulation
async function testRealtimeAudioInput() {
  console.log('\n\nTesting Realtime Audio Input...');
  
  const ai = new GoogleGenAI({ apiKey: REAL_API_KEY });
  const model = 'gemini-2.0-flash-live-001';
  const config = { 
    responseModalities: [Modality.TEXT],
    inputAudioTranscription: {}
  };

  try {
    console.log('Connecting for realtime audio input...');
    
    const session = await ai.live.connect({
      model: model,
      callbacks: {
        onopen: function () {
          console.log('Connection opened for audio input');
        },
        onmessage: function (message) {
          if (message.serverContent?.inputTranscription) {
            console.log('Input transcription:', message.serverContent.inputTranscription.text);
          }
          if (message.serverContent?.modelTurn?.parts) {
            const parts = message.serverContent.modelTurn.parts;
            for (const part of parts) {
              if (part.text) {
                console.log('Response:', part.text);
              }
            }
          }
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

    console.log('Simulating audio input...');
    
    // Simulate sending audio chunks (in real app, this would come from microphone)
    // Create a simple sine wave as test audio
    const sampleRate = 16000;
    const duration = 2; // 2 seconds
    const frequency = 440; // A4 note
    const samples = sampleRate * duration;
    const audioBuffer = Buffer.alloc(samples * 2); // 16-bit PCM
    
    for (let i = 0; i < samples; i++) {
      const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.3;
      const value = Math.floor(sample * 32767);
      audioBuffer.writeInt16LE(value, i * 2);
    }
    
    // Send audio in chunks
    const chunkSize = 8000; // 0.5 seconds
    for (let i = 0; i < audioBuffer.length; i += chunkSize) {
      const chunk = audioBuffer.slice(i, Math.min(i + chunkSize, audioBuffer.length));
      const base64Audio = chunk.toString('base64');
      
      session.sendRealtimeInput({
        audio: {
          data: base64Audio,
          mimeType: 'audio/pcm;rate=16000'
        }
      });
      
      console.log(`Sent audio chunk: ${(chunk.length / 1024).toFixed(2)}KB`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('Closing session...');
    session.close();
    
    console.log('Realtime audio input test completed successfully');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Verify output files
function verifyOutputFiles() {
  console.log('\nVerifying output files...');
  
  const files = ['test-output.pcm', 'test-output.wav'];
  let allFilesExist = true;
  
  files.forEach(filename => {
    try {
      const stats = fs.statSync(filename);
      console.log(`File: ${filename}`);
      console.log(`  Size: ${stats.size} bytes`);
      console.log(`  Modified: ${stats.mtime.toISOString()}`);
      
      if (stats.size === 0) {
        console.error(`  WARNING: File is empty`);
        allFilesExist = false;
      }
    } catch (error) {
      console.error(`  ERROR: File not found - ${filename}`);
      allFilesExist = false;
    }
  });
  
  if (allFilesExist) {
    console.log('All output files verified successfully');
  } else {
    console.error('Some output files are missing or empty');
  }
  
  return allFilesExist;
}

// Run all tests
async function runAllTests() {
  await testAudioStreaming();
  await testRealtimeAudioInput();
}

runAllTests().catch(console.error);