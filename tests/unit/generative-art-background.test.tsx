import React from 'react';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GenerativeArtBackgroundWebGL } from '../../src/generative-art-background-webgl';

describe('GenerativeArtBackgroundWebGL', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalConsoleError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    console.error = jest.fn();
    HTMLCanvasElement.prototype.getContext = jest.fn(() => null);
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    console.error = originalConsoleError;
  });

  it('renders canvas element', () => {
    const { container } = render(<GenerativeArtBackgroundWebGL />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveClass('fixed', 'inset-0', 'w-full', 'h-full', 'pointer-events-none');
    expect(canvas?.style.zIndex).toBe('0');
  });

  it('requests a WebGL context', () => {
    render(<GenerativeArtBackgroundWebGL />);
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith(
      'webgl',
      expect.objectContaining({
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true
      })
    );
  });

  it('sets canvas dimensions to window size and updates on resize', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 });

    const { container } = render(<GenerativeArtBackgroundWebGL />);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;

    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
    window.dispatchEvent(new Event('resize'));

    await waitFor(() => {
      expect(canvas.width).toBe(1280);
      expect(canvas.height).toBe(720);
    });
  });
});
