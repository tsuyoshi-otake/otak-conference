// Mock @google/genai module
jest.mock('@google/genai');
require('@testing-library/jest-dom');

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock HTMLMediaElement methods
window.HTMLMediaElement.prototype.play = jest.fn();
window.HTMLMediaElement.prototype.pause = jest.fn();
window.HTMLMediaElement.prototype.load = jest.fn();

// Mock WebRTC APIs
global.RTCPeerConnection = jest.fn().mockImplementation(() => ({
  createOffer: jest.fn(),
  createAnswer: jest.fn(),
  setLocalDescription: jest.fn(),
  setRemoteDescription: jest.fn(),
  addIceCandidate: jest.fn(),
  addTrack: jest.fn(),
  removeTrack: jest.fn(),
  getSenders: jest.fn().mockReturnValue([]),
  getReceivers: jest.fn().mockReturnValue([]),
  close: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
}));

global.RTCSessionDescription = jest.fn();
global.RTCIceCandidate = jest.fn();

// Mock MediaDevices
global.navigator.mediaDevices = {
  getUserMedia: jest.fn(),
  getDisplayMedia: jest.fn(),
  enumerateDevices: jest.fn(),
};

// Mock AudioContext
global.AudioContext = jest.fn().mockImplementation(() => ({
  createMediaStreamSource: jest.fn().mockReturnValue({
    connect: jest.fn(),
    disconnect: jest.fn(),
  }),
  createAnalyser: jest.fn().mockReturnValue({
    connect: jest.fn(),
    disconnect: jest.fn(),
    getByteTimeDomainData: jest.fn(),
    getByteFrequencyData: jest.fn(),
    fftSize: 2048,
  }),
  createScriptProcessor: jest.fn().mockReturnValue({
    connect: jest.fn(),
    disconnect: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }),
  close: jest.fn(),
}));
// Mock MediaRecorder
global.MediaRecorder = jest.fn().mockImplementation(() => ({
  start: jest.fn(),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  state: 'inactive',
  ondataavailable: null,
  onstop: null,
}));

// Mock MediaRecorder.isTypeSupported
MediaRecorder.isTypeSupported = jest.fn().mockReturnValue(true);

// Mock WebSocket
global.WebSocket = jest.fn().mockImplementation(() => ({
  send: jest.fn(),
  close: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  readyState: 1, // WebSocket.OPEN
}));

// Define WebSocket constants
WebSocket.CONNECTING = 0;
WebSocket.OPEN = 1;
WebSocket.CLOSING = 2;
WebSocket.CLOSED = 3;