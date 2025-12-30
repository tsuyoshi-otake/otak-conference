import type { PerlinNoise } from './perlin';
import { createParticleUpdateContext, updateSingleParticle } from './particleUpdate';

export type Dimensions = {
  width: number;
  height: number;
};

export type ParticleData = {
  positions: Float32Array;
  velocities: Float32Array;
  ages: Float32Array;
  lifespans: Float32Array;
  colors: Float32Array;
  maxSpeeds: Float32Array;
  initialized: boolean;
};

export const createParticleData = (particleCount: number): ParticleData => ({
  positions: new Float32Array(particleCount * 2),
  velocities: new Float32Array(particleCount * 2),
  ages: new Float32Array(particleCount),
  lifespans: new Float32Array(particleCount),
  colors: new Float32Array(particleCount * 3),
  maxSpeeds: new Float32Array(particleCount),
  initialized: false
});

export const initializeParticles = (
  particleData: ParticleData,
  particleCount: number,
  dimensions: Dimensions
): void => {
  if (particleData.initialized) {
    return;
  }

  const { positions, velocities, ages, lifespans, colors, maxSpeeds } = particleData;

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
    let r;
    let g;
    let b;

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

  particleData.initialized = true;
};

type UpdateParams = {
  particleData: ParticleData;
  particleCount: number;
  dimensions: Dimensions;
  scale: number;
  inc: number;
  zoff: number;
  noise: PerlinNoise;
  mouse: { x: number; y: number };
  isInConference: boolean;
  onGeminiSpeaking: boolean;
  geminiCenterX: number;
  geminiCenterY: number;
  geminiRadius: number;
  geminiPulseRef: { current: number };
};

export const updateParticles = ({
  particleData,
  particleCount,
  dimensions,
  scale,
  inc,
  zoff,
  noise,
  mouse,
  isInConference,
  onGeminiSpeaking,
  geminiCenterX,
  geminiCenterY,
  geminiRadius,
  geminiPulseRef
}: UpdateParams): number => {
  // Update Gemini pulse animation
  if (isInConference) {
    geminiPulseRef.current += onGeminiSpeaking ? 0.15 : 0.05;
  }

  const context = createParticleUpdateContext({
    particleData,
    dimensions,
    scale,
    inc,
    zoff,
    noise,
    mouse,
    isInConference,
    onGeminiSpeaking,
    geminiCenterX,
    geminiCenterY,
    geminiRadius,
    geminiPulseRef
  });

  for (let i = 0; i < particleCount; i++) {
    updateSingleParticle(context, i);
  }

  return zoff + 0.002;
};
