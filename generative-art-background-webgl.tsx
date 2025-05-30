import React, { useEffect, useRef, useState } from 'react';

// WebGL shader sources
const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec2 a_velocity;
  attribute float a_age;
  attribute float a_lifespan;
  attribute vec3 a_color;
  
  uniform vec2 u_resolution;
  uniform float u_time;
  
  varying float v_alpha;
  varying vec3 v_color;
  
  void main() {
    vec2 position = a_position / u_resolution * 2.0 - 1.0;
    gl_Position = vec4(position * vec2(1, -1), 0, 1);
    
    float lifeFactor = a_age / a_lifespan;
    float fadeIn = min(1.0, a_age / 20.0);
    float fadeOut = 1.0 - lifeFactor * lifeFactor;
    v_alpha = fadeIn * fadeOut * 0.8;
    
    float speed = length(a_velocity);
    v_color = a_color + vec3(speed * 0.1);
    
    gl_PointSize = 2.0 + speed * 2.0;
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  
  varying float v_alpha;
  varying vec3 v_color;
  
  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    
    if (dist > 0.5) {
      discard;
    }
    
    float alpha = v_alpha * (1.0 - dist * 2.0);
    gl_FragColor = vec4(v_color, alpha);
  }
`;

// Simple 2D Perlin noise implementation
class PerlinNoise {
  private permutation: number[];
  private p: number[];

  constructor() {
    this.permutation = [];
    for (let i = 0; i < 256; i++) {
      this.permutation[i] = i;
    }
    
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.permutation[i], this.permutation[j]] = [this.permutation[j], this.permutation[i]];
    }
    
    this.p = [];
    for (let i = 0; i < 512; i++) {
      this.p[i] = this.permutation[i % 256];
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    
    x -= Math.floor(x);
    y -= Math.floor(y);
    
    const u = this.fade(x);
    const v = this.fade(y);
    
    const a = this.p[X] + Y;
    const aa = this.p[a];
    const ab = this.p[a + 1];
    const b = this.p[X + 1] + Y;
    const ba = this.p[b];
    const bb = this.p[b + 1];
    
    return this.lerp(v,
      this.lerp(u, this.grad(this.p[aa], x, y), this.grad(this.p[ba], x - 1, y)),
      this.lerp(u, this.grad(this.p[ab], x, y - 1), this.grad(this.p[bb], x - 1, y - 1))
    );
  }
}

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
  const particleDataRef = useRef<{
    positions: Float32Array;
    velocities: Float32Array;
    ages: Float32Array;
    lifespans: Float32Array;
    colors: Float32Array;
    maxSpeeds: Float32Array;
    initialized: boolean;
  } | null>(null);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  
  const particleCount = 5000; // Much more particles with GPU
  const scale = 30;
  const inc = 0.05;
  let zoff = 0;
  
  // Gemini avatar parameters
  const geminiCenterX = dimensions.width / 2;
  const geminiCenterY = dimensions.height / 2;
  const geminiRadius = 100;
  const geminiPulseRef = useRef(0);

  // Create WebGL shader
  const createShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    
    return shader;
  };

  // Create WebGL program
  const createProgram = (gl: WebGLRenderingContext): WebGLProgram | null => {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    
    if (!vertexShader || !fragmentShader) return null;
    
    const program = gl.createProgram();
    if (!program) return null;
    
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    
    return program;
  };

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
      program = createProgram(gl);
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
      particleDataRef.current = {
        positions: new Float32Array(particleCount * 2),
        velocities: new Float32Array(particleCount * 2),
        ages: new Float32Array(particleCount),
        lifespans: new Float32Array(particleCount),
        colors: new Float32Array(particleCount * 3),
        maxSpeeds: new Float32Array(particleCount),
        initialized: false
      };
    }
    
    const { positions, velocities, ages, lifespans, colors, maxSpeeds } = particleDataRef.current;
    
    // Initialize particles only once
    if (!particleDataRef.current.initialized) {
      for (let i = 0; i < particleCount; i++) {
        positions[i * 2] = Math.random() * dimensions.width;
        positions[i * 2 + 1] = Math.random() * dimensions.height;
        velocities[i * 2] = 0;
        velocities[i * 2 + 1] = 0;
        ages[i] = 0;
        lifespans[i] = 300 + Math.random() * 700;
        maxSpeeds[i] = 1 + Math.random() * 3;
      
      // Color palette
      const colorChoice = Math.random();
      let r, g, b;
      
      if (colorChoice < 0.4) {
        // Deep purple to blue
        r = 0.4 + Math.random() * 0.2;
        g = 0.2 + Math.random() * 0.3;
        b = 0.8 + Math.random() * 0.2;
      } else if (colorChoice < 0.6) {
        // Pink/Magenta
        r = 0.8 + Math.random() * 0.2;
        g = 0.3 + Math.random() * 0.3;
        b = 0.6 + Math.random() * 0.3;
      } else if (colorChoice < 0.75) {
        // Orange/Yellow
        r = 0.9 + Math.random() * 0.1;
        g = 0.6 + Math.random() * 0.3;
        b = 0.2 + Math.random() * 0.2;
      } else if (colorChoice < 0.9) {
        // Cyan/Turquoise
        r = 0.2 + Math.random() * 0.3;
        g = 0.7 + Math.random() * 0.3;
        b = 0.8 + Math.random() * 0.2;
      } else {
        // Red
        r = 0.9 + Math.random() * 0.1;
        g = 0.2 + Math.random() * 0.2;
        b = 0.2 + Math.random() * 0.2;
      }
      
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }
      particleDataRef.current.initialized = true;
    }
    
    // Create buffers
    const positionBuffer = gl.createBuffer();
    const velocityBuffer = gl.createBuffer();
    const ageBuffer = gl.createBuffer();
    const lifespanBuffer = gl.createBuffer();
    const colorBuffer = gl.createBuffer();
    
    // Animation loop
    let time = 0;
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
      
      const cols = Math.floor(dimensions.width / scale);
      const rows = Math.floor(dimensions.height / scale);
      
      // Update Gemini pulse animation
      if (isInConference) {
        geminiPulseRef.current += onGeminiSpeaking ? 0.15 : 0.05;
      }
      
      // Update particles
      for (let i = 0; i < particleCount; i++) {
        const x = Math.floor(positions[i * 2] / scale);
        const y = Math.floor(positions[i * 2 + 1] / scale);
        
        if (x >= 0 && x < cols && y >= 0 && y < rows) {
          // Calculate flow field
          const xoff = x * inc;
          const yoff = y * inc;
          
          const noise1 = noiseRef.current.noise(xoff, yoff + zoff);
          const noise2 = noiseRef.current.noise(xoff * 2, yoff * 2 + zoff * 0.5) * 0.5;
          const noise3 = noiseRef.current.noise(xoff * 4, yoff * 4 + zoff * 0.25) * 0.25;
          
          let angle = (noise1 + noise2 + noise3) * Math.PI * 4;
          angle += Math.sin(zoff * 2 + x * 0.1) * 0.5;
          angle += Math.cos(zoff * 1.5 + y * 0.1) * 0.3;
          
          // Mouse influence
          const mouseDist = Math.sqrt(
            Math.pow(mouseRef.current.x - positions[i * 2], 2) + 
            Math.pow(mouseRef.current.y - positions[i * 2 + 1], 2)
          );
          
          if (mouseDist < 150) {
            const mouseInfluence = (150 - mouseDist) / 150;
            const mouseAngle = Math.atan2(
              mouseRef.current.y - positions[i * 2 + 1],
              mouseRef.current.x - positions[i * 2]
            );
            angle += mouseInfluence * (mouseAngle + Math.PI * 0.5);
          }
          
          // Apply force
          const forceMultiplier = 0.5 + Math.random() * 0.5;
          velocities[i * 2] += Math.cos(angle) * forceMultiplier * 0.5;
          velocities[i * 2 + 1] += Math.sin(angle) * forceMultiplier * 0.5;
        }
        
        // Gemini avatar attraction when in conference
        if (isInConference) {
          const dxToGemini = geminiCenterX - positions[i * 2];
          const dyToGemini = geminiCenterY - positions[i * 2 + 1];
          const distToGemini = Math.sqrt(dxToGemini * dxToGemini + dyToGemini * dyToGemini);
          
          // Create circular formation
          const targetRadius = geminiRadius + Math.sin(geminiPulseRef.current + i * 0.1) * 20;
          
          if (distToGemini < targetRadius * 3) {
            // Particles near the center form a circle
            const angleToGemini = Math.atan2(dyToGemini, dxToGemini);
            const targetX = geminiCenterX - Math.cos(angleToGemini) * targetRadius;
            const targetY = geminiCenterY - Math.sin(angleToGemini) * targetRadius;
            
            const attractionForce = 0.1;
            velocities[i * 2] += (targetX - positions[i * 2]) * attractionForce;
            velocities[i * 2 + 1] += (targetY - positions[i * 2 + 1]) * attractionForce;
            
            // Add orbital motion
            const orbitalSpeed = onGeminiSpeaking ? 0.05 : 0.02;
            velocities[i * 2] += -dyToGemini / distToGemini * orbitalSpeed;
            velocities[i * 2 + 1] += dxToGemini / distToGemini * orbitalSpeed;
          }
        }
        
        // Apply damping
        velocities[i * 2] *= 0.98;
        velocities[i * 2 + 1] *= 0.98;
        
        // Limit velocity
        const speed = Math.sqrt(velocities[i * 2] * velocities[i * 2] + velocities[i * 2 + 1] * velocities[i * 2 + 1]);
        if (speed > maxSpeeds[i]) {
          velocities[i * 2] = (velocities[i * 2] / speed) * maxSpeeds[i];
          velocities[i * 2 + 1] = (velocities[i * 2 + 1] / speed) * maxSpeeds[i];
        }
        
        // Update position
        positions[i * 2] += velocities[i * 2];
        positions[i * 2 + 1] += velocities[i * 2 + 1];
        
        // Update age
        ages[i]++;
        
        // Reset if needed
        if (ages[i] > lifespans[i] || 
            positions[i * 2] < 0 || positions[i * 2] > dimensions.width ||
            positions[i * 2 + 1] < 0 || positions[i * 2 + 1] > dimensions.height) {
          positions[i * 2] = Math.random() * dimensions.width;
          positions[i * 2 + 1] = Math.random() * dimensions.height;
          velocities[i * 2] = 0;
          velocities[i * 2 + 1] = 0;
          ages[i] = 0;
          lifespans[i] = 300 + Math.random() * 700;
        }
      }
      
      zoff += 0.002;
      
      // Update buffers
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
      
      gl.bindBuffer(gl.ARRAY_BUFFER, velocityBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, velocities, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(velocityLoc);
      gl.vertexAttribPointer(velocityLoc, 2, gl.FLOAT, false, 0, 0);
      
      gl.bindBuffer(gl.ARRAY_BUFFER, ageBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, ages, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(ageLoc);
      gl.vertexAttribPointer(ageLoc, 1, gl.FLOAT, false, 0, 0);
      
      gl.bindBuffer(gl.ARRAY_BUFFER, lifespanBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, lifespans, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(lifespanLoc);
      gl.vertexAttribPointer(lifespanLoc, 1, gl.FLOAT, false, 0, 0);
      
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
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