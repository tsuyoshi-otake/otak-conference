import React from 'react';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GenerativeArtBackgroundWebGL } from '../../generative-art-background-webgl';

// Mock WebGL context
const mockWebGLContext = {
  createShader: jest.fn(() => ({})),
  shaderSource: jest.fn(),
  compileShader: jest.fn(),
  getShaderParameter: jest.fn(() => true),
  createProgram: jest.fn(() => ({})),
  attachShader: jest.fn(),
  linkProgram: jest.fn(),
  getProgramParameter: jest.fn(() => true),
  useProgram: jest.fn(),
  getAttribLocation: jest.fn(() => 0),
  getUniformLocation: jest.fn(() => ({})),
  createBuffer: jest.fn(() => ({})),
  bindBuffer: jest.fn(),
  bufferData: jest.fn(),
  enableVertexAttribArray: jest.fn(),
  vertexAttribPointer: jest.fn(),
  uniform2f: jest.fn(),
  uniform1f: jest.fn(),
  clearColor: jest.fn(),
  clear: jest.fn(),
  enable: jest.fn(),
  blendFunc: jest.fn(),
  drawArrays: jest.fn(),
  viewport: jest.fn(),
  VERTEX_SHADER: 35633,
  FRAGMENT_SHADER: 35632,
  COMPILE_STATUS: 35713,
  LINK_STATUS: 35714,
  ARRAY_BUFFER: 34962,
  STATIC_DRAW: 35044,
  FLOAT: 5126,
  COLOR_BUFFER_BIT: 16384,
  BLEND: 3042,
  SRC_ALPHA: 770,
  ONE_MINUS_SRC_ALPHA: 771,
  POINTS: 0
} as any;

// Mock HTMLCanvasElement
HTMLCanvasElement.prototype.getContext = jest.fn((contextType) => {
  if (contextType === 'webgl' || contextType === 'webgl2') {
    return mockWebGLContext;
  }
  return null;
}) as any;

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn((cb) => {
  setTimeout(cb, 16);
  return 1;
});

global.cancelAnimationFrame = jest.fn();

describe('GenerativeArtBackgroundWebGL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock window dimensions
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1920,
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 1080,
    });
  });

  it('renders canvas element', () => {
    const { container } = render(<GenerativeArtBackgroundWebGL />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveClass('fixed', 'inset-0', 'w-full', 'h-full', 'pointer-events-none');
  });

  it('initializes WebGL context', () => {
    render(<GenerativeArtBackgroundWebGL />);
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true
    });
  });

  it('sets canvas dimensions to window size', () => {
    render(<GenerativeArtBackgroundWebGL />);
    const canvas = document.querySelector('canvas');
    expect(canvas?.width).toBe(window.innerWidth);
    expect(canvas?.height).toBe(window.innerHeight);
  });

  it('starts animation loop', async () => {
    render(<GenerativeArtBackgroundWebGL />);
    await waitFor(() => {
      expect(global.requestAnimationFrame).toHaveBeenCalled();
    });
  });

  it('creates shaders and program', async () => {
    render(<GenerativeArtBackgroundWebGL />);
    await waitFor(() => {
      expect(mockWebGLContext.createShader).toHaveBeenCalledWith(mockWebGLContext.VERTEX_SHADER);
      expect(mockWebGLContext.createShader).toHaveBeenCalledWith(mockWebGLContext.FRAGMENT_SHADER);
      expect(mockWebGLContext.createProgram).toHaveBeenCalled();
    });
  });

  it('sets up WebGL buffers', async () => {
    render(<GenerativeArtBackgroundWebGL />);
    await waitFor(() => {
      expect(mockWebGLContext.createBuffer).toHaveBeenCalled();
      expect(mockWebGLContext.bindBuffer).toHaveBeenCalled();
      expect(mockWebGLContext.bufferData).toHaveBeenCalled();
    });
  });

  it('enables blending for particle effects', async () => {
    render(<GenerativeArtBackgroundWebGL />);
    await waitFor(() => {
      expect(mockWebGLContext.enable).toHaveBeenCalledWith(mockWebGLContext.BLEND);
      expect(mockWebGLContext.blendFunc).toHaveBeenCalledWith(
        mockWebGLContext.SRC_ALPHA,
        mockWebGLContext.ONE_MINUS_SRC_ALPHA
      );
    });
  });

  it('cleans up animation on unmount', () => {
    const { unmount } = render(<GenerativeArtBackgroundWebGL />);
    unmount();
    expect(global.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('responds to emotion state changes', async () => {
    const happyEmotion = {
      emotion: 'happy',
      confidence: 0.8,
      description: 'Happy emotion',
      timestamp: Date.now()
    };

    const { rerender } = render(<GenerativeArtBackgroundWebGL myCurrentEmotion={happyEmotion} />);
    
    await waitFor(() => {
      expect(mockWebGLContext.uniform1f).toHaveBeenCalled();
    });

    const sadEmotion = {
      emotion: 'sad',
      confidence: 0.7,
      description: 'Sad emotion',
      timestamp: Date.now()
    };

    rerender(<GenerativeArtBackgroundWebGL myCurrentEmotion={sadEmotion} />);
    
    await waitFor(() => {
      expect(mockWebGLContext.uniform1f).toHaveBeenCalled();
    });
  });

  it('handles window resize', async () => {
    const { act } = await import('@testing-library/react');
    render(<GenerativeArtBackgroundWebGL />);
    
    await act(async () => {
      // Simulate window resize
      Object.defineProperty(window, 'innerWidth', { value: 1280 });
      Object.defineProperty(window, 'innerHeight', { value: 720 });
      
      // Trigger resize event
      global.dispatchEvent(new Event('resize'));
    });
    
    const canvas = document.querySelector('canvas');
    expect(canvas?.width).toBe(1280);
    expect(canvas?.height).toBe(720);
  });

  it('handles missing WebGL context gracefully', () => {
    // Mock failed WebGL context
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = jest.fn(() => null) as any;
    
    expect(() => {
      render(<GenerativeArtBackgroundWebGL />);
    }).not.toThrow();
    
    // Restore original mock
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });
});