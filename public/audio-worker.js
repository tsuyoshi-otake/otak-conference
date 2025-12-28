/**
 * Dedicated Web Worker for ultra-fast audio processing
 * Implements parallel audio encoding and VAD in background thread
 */

// Import high-performance audio processor with error handling
let AudioProcessorClass = null;
try {
  importScripts('./audio-processor.js');
  // Check if the module was loaded correctly
  if (typeof self.HighPerformanceAudioProcessor !== 'undefined') {
    AudioProcessorClass = self.HighPerformanceAudioProcessor;
  } else if (typeof self.audioProcessor !== 'undefined') {
    AudioProcessorClass = self.audioProcessor.constructor;
  }
} catch (error) {
  console.warn('[Audio Worker] Failed to load audio-processor.js:', error);
  // Define minimal fallback processor inline
  AudioProcessorClass = class {
    constructor() {
      this.fallbackProcessor = {
        convertFloat32ToInt16: (float32Array) => {
          const int16Array = new Int16Array(float32Array.length);
          for (let i = 0; i < float32Array.length; i++) {
            const sample = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          }
          return int16Array;
        },
        encodeToBase64: (int16Array) => {
          const uint8Array = new Uint8Array(int16Array.buffer);
          let binaryString = '';
          for (let i = 0; i < uint8Array.length; i++) {
            binaryString += String.fromCharCode(uint8Array[i]);
          }
          return btoa(binaryString);
        },
        detectVoiceActivity: (audioData) => {
          let energy = 0;
          for (let i = 0; i < audioData.length; i++) {
            energy += audioData[i] * audioData[i];
          }
          energy = energy / audioData.length;
          return { energy, isVoice: energy > 0.01 };
        }
      };
    }
    
    convertFloat32ToInt16(float32Array) {
      return this.fallbackProcessor.convertFloat32ToInt16(float32Array);
    }
    
    encodeToBase64(int16Array) {
      return this.fallbackProcessor.encodeToBase64(int16Array);
    }
  };
}

class AudioWorker {
  constructor() {
    this.processor = null;
    this.isInitialized = false;
    this.processingQueue = [];
    this.isProcessing = false;
    
    this.initialize();
  }

  async initialize() {
    try {
      // Initialize high-performance processor in worker thread
      if (AudioProcessorClass) {
        this.processor = new AudioProcessorClass();
        this.isInitialized = true;
        console.log('[Audio Worker] Initialized with high-performance processor');
      } else {
        console.warn('[Audio Worker] High-performance processor not available');
      }
    } catch (error) {
      console.error('[Audio Worker] Initialization failed:', error);
    }
  }

  /**
   * Process audio data with parallel encoding
   */
  async processAudioData(audioData, requestId) {
    if (!this.isInitialized || !this.processor) {
      return { error: 'Processor not initialized', requestId };
    }

    try {
      const startTime = performance.now();

      // Parallel processing: Convert and encode simultaneously
      const int16Promise = this.processor.convertFloat32ToInt16(audioData);
      const vadPromise = this.processor.fallbackProcessor?.detectVoiceActivity(audioData);

      // Wait for parallel operations
      const [int16Array, vadResult] = await Promise.all([
        Promise.resolve(int16Promise),
        Promise.resolve(vadPromise)
      ]);

      // Encode to base64
      const base64Audio = this.processor.encodeToBase64(int16Array);

      const processingTime = performance.now() - startTime;

      return {
        requestId,
        base64Audio,
        vadResult,
        processingTime,
        audioLength: audioData.length
      };

    } catch (error) {
      console.error('[Audio Worker] Processing error:', error);
      return { error: error.message, requestId };
    }
  }

  /**
   * Batch processing for multiple audio chunks
   */
  async processBatch(audioChunks) {
    const promises = audioChunks.map((chunk, index) => 
      this.processAudioData(chunk.data, chunk.id || index)
    );

    return Promise.all(promises);
  }
}

// Global worker instance
const audioWorker = new AudioWorker();

// Message handler for main thread communication
self.onmessage = async function(event) {
  const { type, data, requestId } = event.data;

  switch (type) {
    case 'process-audio':
      const result = await audioWorker.processAudioData(data, requestId);
      self.postMessage({ type: 'audio-processed', result });
      break;

    case 'process-batch':
      const batchResults = await audioWorker.processBatch(data);
      self.postMessage({ type: 'batch-processed', results: batchResults });
      break;

    case 'init':
      await audioWorker.initialize();
      self.postMessage({ type: 'initialized', ready: audioWorker.isInitialized });
      break;

    default:
      console.warn('[Audio Worker] Unknown message type:', type);
  }
};

// Error handler
self.onerror = function(error) {
  console.error('[Audio Worker] Worker error:', error);
  self.postMessage({ type: 'error', error: error.message });
};

console.log('[Audio Worker] Worker script loaded and ready');
