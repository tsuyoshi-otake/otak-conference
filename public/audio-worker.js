/**
 * Dedicated Web Worker for ultra-fast audio processing
 * Implements parallel audio encoding and VAD in background thread
 */

// Import high-performance audio processor with error handling
try {
  importScripts('./audio-processor.js');
} catch (error) {
  console.warn('[Audio Worker] Failed to load audio-processor.js:', error);
  // Define fallback processor inline
  self.HighPerformanceAudioProcessor = null;
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
      if (typeof HighPerformanceAudioProcessor !== 'undefined') {
        this.processor = new HighPerformanceAudioProcessor();
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