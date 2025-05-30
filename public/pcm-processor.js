/**
 * @class PCMProcessor
 * @extends AudioWorkletProcessor
 * @description Processes PCM audio data in a Web Audio API context
 * Designed to handle 24kHz audio output from Gemini Live API
 */
class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = new Float32Array(0);
        this.bufferSize = 0;
        this.maxBufferSize = 48000; // 2 seconds at 24kHz
        
        console.log('[PCM Processor] Initialized');

        this.port.onmessage = (e) => {
            try {
                const newData = e.data;
                if (!newData || newData.length === 0) {
                    return;
                }
                
                // Prevent buffer overflow
                if (this.bufferSize + newData.length > this.maxBufferSize) {
                    console.warn('[PCM Processor] Buffer overflow, clearing old data');
                    this.buffer = new Float32Array(0);
                    this.bufferSize = 0;
                }
                
                // Append new data to buffer
                const newBuffer = new Float32Array(this.bufferSize + newData.length);
                if (this.bufferSize > 0) {
                    newBuffer.set(this.buffer.slice(0, this.bufferSize));
                }
                newBuffer.set(newData, this.bufferSize);
                this.buffer = newBuffer;
                this.bufferSize = newBuffer.length;
                
                console.log(`[PCM Processor] Added ${newData.length} samples, buffer size: ${this.bufferSize}`);
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