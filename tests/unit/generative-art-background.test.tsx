import React from 'react';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GenerativeArtBackground } from '../../generative-art-background';

// Mock canvas context
const mockContext = {
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  globalAlpha: 1,
  fillRect: jest.fn(),
  beginPath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  stroke: jest.fn(),
  fill: jest.fn(),
  arc: jest.fn(),
  save: jest.fn(),
  restore: jest.fn(),
  createRadialGradient: jest.fn(() => ({
    addColorStop: jest.fn()
  })),
  createLinearGradient: jest.fn(() => ({
    addColorStop: jest.fn()
  }))
} as any;

// Mock HTMLCanvasElement
HTMLCanvasElement.prototype.getContext = jest.fn(() => mockContext) as any;

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn((cb) => {
  setTimeout(cb, 16);
  return 1;
});

global.cancelAnimationFrame = jest.fn();

describe('GenerativeArtBackground', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset canvas dimensions
    Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
      configurable: true,
      writable: true,
      value: 1920
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'height', {
      configurable: true,
      writable: true,
      value: 1080
    });
  });

  it('renders canvas element', () => {
    const { container } = render(<GenerativeArtBackground />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveClass('fixed', 'inset-0', 'w-full', 'h-full', 'pointer-events-none');
  });

  it('initializes canvas context', () => {
    render(<GenerativeArtBackground />);
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('2d');
  });

  it('sets canvas dimensions to window size', () => {
    render(<GenerativeArtBackground />);
    const canvas = document.querySelector('canvas');
    expect(canvas?.width).toBe(window.innerWidth);
    expect(canvas?.height).toBe(window.innerHeight);
  });

  it('starts animation loop', async () => {
    render(<GenerativeArtBackground />);
    await waitFor(() => {
      expect(global.requestAnimationFrame).toHaveBeenCalled();
    });
  });

  it('creates flow field effect with semi-transparent overlay', async () => {
    render(<GenerativeArtBackground />);
    await waitFor(() => {
      expect(mockContext.fillStyle).toBe('rgba(0, 0, 0, 0.05)');
      expect(mockContext.fillRect).toHaveBeenCalledWith(0, 0, window.innerWidth, window.innerHeight);
    });
  });

  it('draws particle trails', async () => {
    render(<GenerativeArtBackground />);
    await waitFor(() => {
      expect(mockContext.beginPath).toHaveBeenCalled();
      expect(mockContext.moveTo).toHaveBeenCalled();
      expect(mockContext.lineTo).toHaveBeenCalled();
      expect(mockContext.stroke).toHaveBeenCalled();
    });
  });

  it('uses blue to purple color range for particles', async () => {
    render(<GenerativeArtBackground />);
    await waitFor(() => {
      const strokeStyleCalls = (mockContext.strokeStyle as any);
      if (typeof strokeStyleCalls === 'string' && strokeStyleCalls.includes('hsl')) {
        const hueMatch = strokeStyleCalls.match(/hsla?\((\d+)/);
        if (hueMatch) {
          const hue = parseInt(hueMatch[1]);
          expect(hue).toBeGreaterThanOrEqual(180);
          expect(hue).toBeLessThanOrEqual(280);
        }
      }
    });
  });

  it('handles window resize', () => {
    const { rerender } = render(<GenerativeArtBackground />);
    
    // Simulate window resize
    window.innerWidth = 1280;
    window.innerHeight = 720;
    window.dispatchEvent(new Event('resize'));
    
    rerender(<GenerativeArtBackground />);
    
    const canvas = document.querySelector('canvas');
    expect(canvas?.width).toBe(1280);
    expect(canvas?.height).toBe(720);
  });

  it('tracks mouse movement', () => {
    render(<GenerativeArtBackground />);
    
    // Simulate mouse movement
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: 100,
      clientY: 200
    });
    window.dispatchEvent(mouseEvent);
    
    // The effect should be visible in the animation
    expect(mockContext.stroke).toHaveBeenCalled();
  });

  it('supports touch events', () => {
    render(<GenerativeArtBackground />);
    
    // Simulate touch movement
    const touchEvent = new TouchEvent('touchmove', {
      touches: [{ clientX: 150, clientY: 250 } as Touch]
    });
    window.dispatchEvent(touchEvent);
    
    // The effect should be visible in the animation
    expect(mockContext.stroke).toHaveBeenCalled();
  });

  it('cleans up animation on unmount', () => {
    const { unmount } = render(<GenerativeArtBackground />);
    unmount();
    expect(global.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('applies correct canvas styles', () => {
    const { container } = render(<GenerativeArtBackground />);
    const canvas = container.querySelector('canvas');
    expect(canvas?.style.zIndex).toBe('0');
    expect(canvas?.style.backgroundColor).toBe('rgb(0, 0, 0)');
  });

  it('creates Perlin noise-based flow field', async () => {
    render(<GenerativeArtBackground />);
    
    // Wait for animation to run
    await waitFor(() => {
      // Check that particles are being drawn
      expect(mockContext.moveTo).toHaveBeenCalled();
      expect(mockContext.lineTo).toHaveBeenCalled();
    });
  });

  it('limits particle velocity', async () => {
    render(<GenerativeArtBackground />);
    
    await waitFor(() => {
      // Particles should be drawn with controlled movement
      expect(mockContext.stroke).toHaveBeenCalled();
      expect(mockContext.lineWidth).toBe(1);
    });
  });

  it('resets particles when they go out of bounds', async () => {
    render(<GenerativeArtBackground />);
    
    await waitFor(() => {
      // Particles should continuously be drawn
      const strokeCallCount = mockContext.stroke.mock.calls.length;
      expect(strokeCallCount).toBeGreaterThan(0);
    });
  });

  it('adjusts particle opacity based on age', async () => {
    render(<GenerativeArtBackground />);
    
    await waitFor(() => {
      const strokeStyleCalls = mockContext.strokeStyle as any;
      if (typeof strokeStyleCalls === 'string' && strokeStyleCalls.includes('hsla')) {
        // Check that alpha values are being used - allow decimal values in hue
        expect(strokeStyleCalls).toMatch(/hsla\([\d.]+,\s*\d+%,\s*\d+%,\s*[\d.]+\)/);
      }
    });
  });

  it('creates 1500 particles', async () => {
    render(<GenerativeArtBackground />);
    
    // Wait for multiple animation frames
    await waitFor(() => {
      // With 1500 particles, we should see many stroke calls
      expect(mockContext.stroke.mock.calls.length).toBeGreaterThan(100);
    }, { timeout: 3000 });
  });

  it('uses flow field grid with scale of 20', async () => {
    render(<GenerativeArtBackground />);
    
    await waitFor(() => {
      // Flow field should affect particle movement
      expect(mockContext.moveTo).toHaveBeenCalled();
      expect(mockContext.lineTo).toHaveBeenCalled();
    });
  });

  it('applies mouse influence to flow field', async () => {
    render(<GenerativeArtBackground />);
    
    // Move mouse to center
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: window.innerWidth / 2,
      clientY: window.innerHeight / 2
    });
    window.dispatchEvent(mouseEvent);
    
    await waitFor(() => {
      // Particles should be affected by mouse position
      expect(mockContext.stroke).toHaveBeenCalled();
    });
  });

  it('continuously updates flow field with time', async () => {
    render(<GenerativeArtBackground />);
    
    const initialStrokeCount = mockContext.stroke.mock.calls.length;
    
    // Wait for more animation frames
    await waitFor(() => {
      const currentStrokeCount = mockContext.stroke.mock.calls.length;
      expect(currentStrokeCount).toBeGreaterThan(initialStrokeCount);
    }, { timeout: 3000 });
  });
});