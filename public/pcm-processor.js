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
        this.totalSamplesProcessed = 0;
        this.lastLogTime = 0;
        
        console.log('[PCM Processor] Initialized');
        console.log(`[PCM Processor] Sample rate: ${sampleRate}Hz`);

        this.port.onmessage = (e) => {
            try {
                const newData = e.data;
                if (!newData || newData.length === 0) {
                    return;
                }
                
                // Prevent buffer overflow
                if (this.bufferSize + newData.length > this.maxBufferSize) {
                    console.warn('[PCM Processor] Buffer overflow, keeping newer data');
                    // Keep the newer data and discard older data
                    const keepSamples = Math.floor(this.maxBufferSize / 2);
                    const newBuffer = new Float32Array(keepSamples + newData.length);
                    newBuffer.set(this.buffer.slice(this.bufferSize - keepSamples), 0);
                    newBuffer.set(newData, keepSamples);
                    this.buffer = newBuffer;
                    this.bufferSize = newBuffer.length;
                } else {
                    // Append new data to buffer
                    const newBuffer = new Float32Array(this.bufferSize + newData.length);
                    if (this.bufferSize > 0) {
                        newBuffer.set(this.buffer.slice(0, this.bufferSize));
                    }
                    newBuffer.set(newData, this.bufferSize);
                    this.buffer = newBuffer;
                    this.bufferSize = newBuffer.length;
                }
                
                // Log periodically instead of every message
                const now = Date.now();
                if (now - this.lastLogTime > 1000) {
                    console.log(`[PCM Processor] Buffer: ${this.bufferSize} samples, Total processed: ${this.totalSamplesProcessed}`);
                    this.lastLogTime = now;
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

        if (this.bufferSize > 0) {
            const samplesToProcess = Math.min(this.bufferSize, requestedSamples);
            
            // Copy data to output
            for (let i = 0; i < samplesToProcess; i++) {
                channelData[i] = this.buffer[i];
            }
            
            // Fill remaining with silence if needed
            for (let i = samplesToProcess; i < requestedSamples; i++) {
                channelData[i] = 0;
            }
            
            // Remove consumed data from buffer
            if (this.bufferSize > samplesToProcess) {
                const remainingData = new Float32Array(this.bufferSize - samplesToProcess);
                remainingData.set(this.buffer.slice(samplesToProcess));
                this.buffer = remainingData;
                this.bufferSize = remainingData.length;
            } else {
                this.buffer = new Float32Array(0);
                this.bufferSize = 0;
            }
            
            this.totalSamplesProcessed += samplesToProcess;
        } else {
            // No data, output silence
            for (let i = 0; i < requestedSamples; i++) {
                channelData[i] = 0;
            }
        }

        return true;
    }
}

registerProcessor("pcm-processor", PCMProcessor);