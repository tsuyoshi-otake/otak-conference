import { decode } from '../gemini-utils';

export const parseMimeType = (mimeType: string): { sampleRate: number; bitsPerSample: number; numChannels: number } => {
  const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
  const [_, format] = fileType.split('/');

  const options = {
    numChannels: 1,
    bitsPerSample: 16,
    sampleRate: 24000 // Default to 24kHz
  };

  // Parse format like "L16" for 16-bit linear PCM
  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  // Parse parameters like "rate=24000"
  for (const param of params) {
    const [key, value] = param.split('=').map(s => s.trim());
    if (key === 'rate') {
      const rate = parseInt(value, 10);
      if (!isNaN(rate)) {
        options.sampleRate = rate;
      }
    }
  }

  return options;
};

export const createWavFromChunks = (audioChunks: string[], mimeType: string): ArrayBuffer => {
  const audioParams = parseMimeType(mimeType);

  // Calculate total raw data length (base64 decoded length)
  const totalRawLength = audioChunks.reduce((sum, chunk) => {
    return sum + Math.floor((chunk.length * 3) / 4); // base64 to binary conversion
  }, 0);

  // Create WAV header based on parsed parameters
  const wavHeader = createWavHeaderBrowser(totalRawLength, audioParams);

  // Combine all base64 chunks into single buffer
  const combinedDataSize = wavHeader.byteLength + totalRawLength;
  const resultBuffer = new ArrayBuffer(combinedDataSize);
  const resultView = new Uint8Array(resultBuffer);

  // Copy header
  resultView.set(new Uint8Array(wavHeader), 0);

  // Decode and copy audio data
  let offset = wavHeader.byteLength;
  for (const chunk of audioChunks) {
    const decodedChunk = decode(chunk);
    resultView.set(new Uint8Array(decodedChunk), offset);
    offset += decodedChunk.byteLength;
  }

  return resultBuffer;
};

export const createWavHeaderBrowser = (
  dataLength: number,
  options: { sampleRate: number; bitsPerSample: number; numChannels: number }
): ArrayBuffer => {
  const { numChannels, sampleRate, bitsPerSample } = options;

  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  // Helper to write string
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');                              // ChunkID
  view.setUint32(4, 36 + dataLength, true);           // ChunkSize
  writeString(8, 'WAVE');                              // Format
  writeString(12, 'fmt ');                             // Subchunk1ID
  view.setUint32(16, 16, true);                        // Subchunk1Size (PCM)
  view.setUint16(20, 1, true);                         // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);               // NumChannels
  view.setUint32(24, sampleRate, true);                // SampleRate
  view.setUint32(28, byteRate, true);                  // ByteRate
  view.setUint16(32, blockAlign, true);                // BlockAlign
  view.setUint16(34, bitsPerSample, true);             // BitsPerSample
  writeString(36, 'data');                             // Subchunk2ID
  view.setUint32(40, dataLength, true);                // Subchunk2Size

  return buffer;
};

export const createWavFile = (audioData: Int16Array, sampleRate: number, channels: number): ArrayBuffer => {
  const byteRate = sampleRate * channels * 2; // 16-bit audio
  const blockAlign = channels * 2;
  const dataSize = audioData.length * 2;
  const fileSize = 44 + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // WAV file header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM format chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Copy audio data
  const audioView = new Int16Array(buffer, 44);
  audioView.set(audioData);

  return buffer;
};
