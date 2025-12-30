import type { PerlinNoise } from './perlin';
import type { Dimensions, ParticleData } from './particleSystem';

export type ParticleUpdateContext = {
  positions: Float32Array;
  velocities: Float32Array;
  ages: Float32Array;
  lifespans: Float32Array;
  maxSpeeds: Float32Array;
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
  cols: number;
  rows: number;
};

export const createParticleUpdateContext = (params: {
  particleData: ParticleData;
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
}): ParticleUpdateContext => {
  const { particleData, dimensions, scale } = params;
  return {
    positions: particleData.positions,
    velocities: particleData.velocities,
    ages: particleData.ages,
    lifespans: particleData.lifespans,
    maxSpeeds: particleData.maxSpeeds,
    dimensions,
    scale,
    inc: params.inc,
    zoff: params.zoff,
    noise: params.noise,
    mouse: params.mouse,
    isInConference: params.isInConference,
    onGeminiSpeaking: params.onGeminiSpeaking,
    geminiCenterX: params.geminiCenterX,
    geminiCenterY: params.geminiCenterY,
    geminiRadius: params.geminiRadius,
    geminiPulseRef: params.geminiPulseRef,
    cols: Math.floor(dimensions.width / scale),
    rows: Math.floor(dimensions.height / scale)
  };
};

export const updateSingleParticle = (context: ParticleUpdateContext, index: number): void => {
  const positionIndex = index * 2;
  const x = Math.floor(context.positions[positionIndex] / context.scale);
  const y = Math.floor(context.positions[positionIndex + 1] / context.scale);

  if (x >= 0 && x < context.cols && y >= 0 && y < context.rows) {
    const angle = computeFlowAngle(context, x, y, positionIndex);
    applyFlowForce(context, positionIndex, angle);
  }

  if (context.isInConference) {
    applyGeminiAttraction(context, positionIndex, index);
  }

  applyDamping(context.velocities, positionIndex);
  limitVelocity(context.velocities, context.maxSpeeds[index], positionIndex);
  advancePosition(context.positions, context.velocities, positionIndex);
  context.ages[index] += 1;

  resetIfNeeded(context, positionIndex, index);
};

const computeFlowAngle = (
  context: ParticleUpdateContext,
  x: number,
  y: number,
  positionIndex: number
): number => {
  const xoff = x * context.inc;
  const yoff = y * context.inc;

  const noise1 = context.noise.noise(xoff, yoff + context.zoff);
  const noise2 = context.noise.noise(xoff * 2, yoff * 2 + context.zoff * 0.5) * 0.5;
  const noise3 = context.noise.noise(xoff * 4, yoff * 4 + context.zoff * 0.25) * 0.25;

  let angle = (noise1 + noise2 + noise3) * Math.PI * 4;
  angle += Math.sin(context.zoff * 2 + x * 0.1) * 0.5;
  angle += Math.cos(context.zoff * 1.5 + y * 0.1) * 0.3;

  const mouseDist = Math.sqrt(
    Math.pow(context.mouse.x - context.positions[positionIndex], 2) +
    Math.pow(context.mouse.y - context.positions[positionIndex + 1], 2)
  );

  if (mouseDist < 150) {
    const mouseInfluence = (150 - mouseDist) / 150;
    const mouseAngle = Math.atan2(
      context.mouse.y - context.positions[positionIndex + 1],
      context.mouse.x - context.positions[positionIndex]
    );
    angle += mouseInfluence * (mouseAngle + Math.PI * 0.5);
  }

  return angle;
};

const applyFlowForce = (
  context: ParticleUpdateContext,
  positionIndex: number,
  angle: number
): void => {
  const forceMultiplier = 0.5 + Math.random() * 0.5;
  context.velocities[positionIndex] += Math.cos(angle) * forceMultiplier * 0.5;
  context.velocities[positionIndex + 1] += Math.sin(angle) * forceMultiplier * 0.5;
};

const applyGeminiAttraction = (
  context: ParticleUpdateContext,
  positionIndex: number,
  index: number
): void => {
  const dxToGemini = context.geminiCenterX - context.positions[positionIndex];
  const dyToGemini = context.geminiCenterY - context.positions[positionIndex + 1];
  const distToGemini = Math.sqrt(dxToGemini * dxToGemini + dyToGemini * dyToGemini);

  const targetRadius = context.geminiRadius + Math.sin(context.geminiPulseRef.current + index * 0.1) * 20;

  if (distToGemini < targetRadius * 3) {
    const angleToGemini = Math.atan2(dyToGemini, dxToGemini);
    const targetX = context.geminiCenterX - Math.cos(angleToGemini) * targetRadius;
    const targetY = context.geminiCenterY - Math.sin(angleToGemini) * targetRadius;

    const attractionForce = 0.1;
    context.velocities[positionIndex] += (targetX - context.positions[positionIndex]) * attractionForce;
    context.velocities[positionIndex + 1] += (targetY - context.positions[positionIndex + 1]) * attractionForce;

    const orbitalSpeed = context.onGeminiSpeaking ? 0.05 : 0.02;
    context.velocities[positionIndex] += -dyToGemini / distToGemini * orbitalSpeed;
    context.velocities[positionIndex + 1] += dxToGemini / distToGemini * orbitalSpeed;
  }
};

const applyDamping = (velocities: Float32Array, positionIndex: number): void => {
  velocities[positionIndex] *= 0.98;
  velocities[positionIndex + 1] *= 0.98;
};

const limitVelocity = (
  velocities: Float32Array,
  maxSpeed: number,
  positionIndex: number
): void => {
  const speed = Math.sqrt(
    velocities[positionIndex] * velocities[positionIndex] +
    velocities[positionIndex + 1] * velocities[positionIndex + 1]
  );
  if (speed > maxSpeed) {
    velocities[positionIndex] = (velocities[positionIndex] / speed) * maxSpeed;
    velocities[positionIndex + 1] = (velocities[positionIndex + 1] / speed) * maxSpeed;
  }
};

const advancePosition = (
  positions: Float32Array,
  velocities: Float32Array,
  positionIndex: number
): void => {
  positions[positionIndex] += velocities[positionIndex];
  positions[positionIndex + 1] += velocities[positionIndex + 1];
};

const resetIfNeeded = (
  context: ParticleUpdateContext,
  positionIndex: number,
  index: number
): void => {
  const outOfBounds =
    context.positions[positionIndex] < 0 ||
    context.positions[positionIndex] > context.dimensions.width ||
    context.positions[positionIndex + 1] < 0 ||
    context.positions[positionIndex + 1] > context.dimensions.height;

  if (context.ages[index] > context.lifespans[index] || outOfBounds) {
    context.positions[positionIndex] = Math.random() * context.dimensions.width;
    context.positions[positionIndex + 1] = Math.random() * context.dimensions.height;
    context.velocities[positionIndex] = 0;
    context.velocities[positionIndex + 1] = 0;
    context.ages[index] = 0;
    context.lifespans[index] = 300 + Math.random() * 700;
  }
};
