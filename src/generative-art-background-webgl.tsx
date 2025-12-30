import React, { useEffect, useRef, useState } from 'react';
import { PerlinNoise } from './generative-art-webgl/perlin';
import { vertexShaderSource, fragmentShaderSource } from './generative-art-webgl/shaders';
import { createProgram } from './generative-art-webgl/webgl';
import {
  createParticleData,
  initializeParticles,
  updateParticles,
  type Dimensions,
  type ParticleData
} from './generative-art-webgl/particleSystem';

interface GenerativeArtBackgroundWebGLProps {
  isInConference?: boolean;
  onGeminiSpeaking?: boolean;
}

export const GenerativeArtBackgroundWebGL: React.FC<GenerativeArtBackgroundWebGLProps> = ({
  isInConference = false,
  onGeminiSpeaking = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const noiseRef = useRef<PerlinNoise>(new PerlinNoise());
  const mouseRef = useRef({ x: 0, y: 0 });
  const particleDataRef = useRef<ParticleData | null>(null);
  const [dimensions, setDimensions] = useState<Dimensions>({
    width: window.innerWidth,
    height: window.innerHeight
  });

  const particleCount = 5000; // Much more particles with GPU
  const scale = 30;
  const inc = 0.05;

  // Gemini avatar parameters
  const geminiCenterX = dimensions.width / 2;
  const geminiCenterY = dimensions.height / 2;
  const geminiRadius = 100;
  const geminiPulseRef = useRef(0);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Track mouse movement
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        mouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  // Initialize and run WebGL
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    // Get or reuse WebGL context
    let gl = glRef.current;
    if (!gl) {
      gl = canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true
      });

      if (!gl) {
        console.error('WebGL not supported');
        return;
      }

      glRef.current = gl;
    }

    // Update viewport for new dimensions
    gl.viewport(0, 0, dimensions.width, dimensions.height);

    // Create or reuse program
    let program = programRef.current;
    if (!program) {
      program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
      if (!program) return;
      programRef.current = program;
    }

    gl.useProgram(program);

    // Set up WebGL state
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.039, 0.039, 0.078, 1.0); // #0a0a14

    // Get attribute and uniform locations
    const positionLoc = gl.getAttribLocation(program, 'a_position');
    const velocityLoc = gl.getAttribLocation(program, 'a_velocity');
    const ageLoc = gl.getAttribLocation(program, 'a_age');
    const lifespanLoc = gl.getAttribLocation(program, 'a_lifespan');
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    const resolutionLoc = gl.getUniformLocation(program, 'u_resolution');
    const timeLoc = gl.getUniformLocation(program, 'u_time');

    // Initialize particle data (reuse if exists)
    if (!particleDataRef.current) {
      particleDataRef.current = createParticleData(particleCount);
    }

    const particleData = particleDataRef.current;
    if (!particleData) {
      return;
    }

    initializeParticles(particleData, particleCount, dimensions);

    // Create buffers
    const positionBuffer = gl.createBuffer();
    const velocityBuffer = gl.createBuffer();
    const ageBuffer = gl.createBuffer();
    const lifespanBuffer = gl.createBuffer();
    const colorBuffer = gl.createBuffer();

    // Animation loop
    let time = 0;
    let zoff = 0;
    const animate = () => {
      if (!gl || !program || !canvas) return;

      // Ensure canvas size matches dimensions
      if (canvas.width !== dimensions.width || canvas.height !== dimensions.height) {
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        gl.viewport(0, 0, dimensions.width, dimensions.height);
      }

      // Clear with trail effect
      gl.clearColor(0.039, 0.039, 0.078, 0.02);
      gl.clear(gl.COLOR_BUFFER_BIT);

      zoff = updateParticles({
        particleData,
        particleCount,
        dimensions,
        scale,
        inc,
        zoff,
        noise: noiseRef.current,
        mouse: mouseRef.current,
        isInConference,
        onGeminiSpeaking,
        geminiCenterX,
        geminiCenterY,
        geminiRadius,
        geminiPulseRef
      });

      // Update buffers
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, particleData.positions, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, velocityBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, particleData.velocities, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(velocityLoc);
      gl.vertexAttribPointer(velocityLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, ageBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, particleData.ages, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(ageLoc);
      gl.vertexAttribPointer(ageLoc, 1, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, lifespanBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, particleData.lifespans, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(lifespanLoc);
      gl.vertexAttribPointer(lifespanLoc, 1, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, particleData.colors, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(colorLoc);
      gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

      // Set uniforms
      gl.uniform2f(resolutionLoc, dimensions.width, dimensions.height);
      gl.uniform1f(timeLoc, time * 0.001);

      // Draw
      gl.drawArrays(gl.POINTS, 0, particleCount);

      time++;
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [dimensions]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{
        zIndex: 0
      }}
    />
  );
};
