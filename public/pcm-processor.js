/**
 * @class PCMProcessor
 * @extends AudioWorkletProcessor
 * @description Processes PCM audio data in a Web Audio API context
 * Designed to handle 24kHz audio output from Gemini Live API
 */
class PCMProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.buffer = new Float32Array(0);
        this.bufferSize = 0;
        this.maxBufferSize = 2400; // 0.1 second at 24kHz for extreme low latency
        
        // デバッグモードを初期化パラメータから取得
        this.debugEnabled = options?.processorOptions?.debugEnabled || false;
        
        if (this.debugEnabled) {
            console.log('[PCM Processor] Initialized (debug mode)');
        }

        this.port.onmessage = (e) => {
            try {
                // Check if this is a debug mode update message
                if (e.data && typeof e.data === 'object' && e.data.type === 'setDebugMode') {
                    this.debugEnabled = e.data.enabled;
                    if (this.debugEnabled) {
                        console.log('[PCM Processor] Debug mode enabled');
                    }
                    return;
                }
                
                const newData = e.data;
                if (!newData || newData.length === 0) {
                    return;
                }
                
                // Aggressive buffer management for extreme low latency
                if (this.bufferSize + newData.length > this.maxBufferSize) {
                    if (this.debugEnabled) {
                        console.warn('[PCM Processor] Buffer overflow, aggressive cleanup for low latency');
                    }
                    // More aggressive: keep only 25% of buffer for extreme low latency
                    const keepSize = Math.floor(this.maxBufferSize / 4);
                    const newBuffer = new Float32Array(keepSize);
                    if (this.bufferSize > keepSize) {
                        newBuffer.set(this.buffer.slice(this.bufferSize - keepSize));
                    } else {
                        newBuffer.set(this.buffer.slice(0, this.bufferSize));
                    }
                    this.buffer = newBuffer;
                    this.bufferSize = newBuffer.length;
                }
                
                // Append new data to buffer
                const newBuffer = new Float32Array(this.bufferSize + newData.length);
                if (this.bufferSize > 0) {
                    newBuffer.set(this.buffer.slice(0, this.bufferSize));
                }
                newBuffer.set(newData, this.bufferSize);
                this.buffer = newBuffer;
                this.bufferSize = newBuffer.length;
                
                if (this.debugEnabled) {
                    console.log(`[PCM Processor] Added ${newData.length} samples, buffer size: ${this.bufferSize}`);
                }
            } catch (error) {
                console.error('[PCM Processor] Error processing audio data:', error);
            }
        };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        if (!output || !output[0]) {
            return true;
        }
        
        const channelData = output[0];
        const requestedSamples = channelData.length;

        if (this.bufferSize >= requestedSamples) {
            // Copy data to output
            for (let i = 0; i < requestedSamples; i++) {
                channelData[i] = this.buffer[i];
            }
            
            // Remove consumed data from buffer
            if (this.bufferSize > requestedSamples) {
                const remainingData = new Float32Array(this.bufferSize - requestedSamples);
                remainingData.set(this.buffer.slice(requestedSamples));
                this.buffer = remainingData;
                this.bufferSize = remainingData.length;
            } else {
                this.buffer = new Float32Array(0);
                this.bufferSize = 0;
            }
        } else {
            // Not enough data, output what we have and pad with silence
            for (let i = 0; i < this.bufferSize; i++) {
                channelData[i] = this.buffer[i];
            }
            for (let i = this.bufferSize; i < requestedSamples; i++) {
                channelData[i] = 0;
            }
            this.buffer = new Float32Array(0);
            this.bufferSize = 0;
        }

        return true;
    }
}

registerProcessor("pcm-processor", PCMProcessor);