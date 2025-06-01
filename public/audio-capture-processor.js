/**
 * @class AudioCaptureProcessor
 * @extends AudioWorkletProcessor
 * @description Captures audio input data and sends it to main thread
 * Designed for Gemini Live API audio input (16kHz)
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        
        // デバッグモードを初期化パラメータから取得
        this.debugEnabled = options?.processorOptions?.debugEnabled || false;
        
        if (this.debugEnabled) {
            console.log('[Audio Capture Processor] Initialized for input capture');
        }
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        
        // Check if we have input audio
        if (!input || !input[0] || input[0].length === 0) {
            return true;
        }
        
        const channelData = input[0]; // Get first channel (mono)
        
        // Create a copy of the audio data to send to main thread
        const audioData = new Float32Array(channelData.length);
        audioData.set(channelData);
        
        // Send audio data to main thread
        this.port.postMessage(audioData);
        
        if (this.debugEnabled) {
            console.log(`[Audio Capture Processor] Captured ${audioData.length} samples`);
        }
        
        return true;
    }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);