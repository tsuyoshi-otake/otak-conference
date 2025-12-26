// Mock AudioContext for Node.js environment
global.AudioContext = class MockAudioContext {
  constructor(options) {
    this.sampleRate = options?.sampleRate || 44100;
    this.destination = {
      connect: jest.fn()
    };
  }
  
  createMediaStreamSource() {
    return {
      connect: jest.fn()
    };
  }
  
  createScriptProcessor() {
    return {
      connect: jest.fn(),
      disconnect: jest.fn(),
      onaudioprocess: null
    };
  }
  
  createGain() {
    return {
      gain: { value: 0 },
      connect: jest.fn()
    };
  }
  
  close() {
    return Promise.resolve();
  }
};

// Mock AudioWorkletNode
global.AudioWorkletNode = class MockAudioWorkletNode {
  constructor() {
    this.port = {
      postMessage: jest.fn()
    };
  }
  
  connect() {}
  disconnect() {}
};

// Mock other browser APIs
global.MediaStream = class MockMediaStream {
  getTracks() {
    return [];
  }
};

// Mock performance.now() if not available
if (typeof performance === 'undefined') {
  global.performance = {
    now: () => Date.now()
  };
}