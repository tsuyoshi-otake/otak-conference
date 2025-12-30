import { TranslationSpeedMode, TranslationSpeedSettings } from '../types';

export const getTranslationSpeedSettings = (mode: TranslationSpeedMode): TranslationSpeedSettings => {
  switch (mode) {
    case TranslationSpeedMode.ULTRAFAST:
      return {
        mode: TranslationSpeedMode.ULTRAFAST,
        sendInterval: 80,
        textBufferDelay: 2000,
        estimatedCostMultiplier: 15.0
      };
    case TranslationSpeedMode.REALTIME:
      return {
        mode: TranslationSpeedMode.REALTIME,
        sendInterval: 300,
        textBufferDelay: 500,
        estimatedCostMultiplier: 5.0
      };
    case TranslationSpeedMode.BALANCED:
      return {
        mode: TranslationSpeedMode.BALANCED,
        sendInterval: 800,
        textBufferDelay: 1000,
        estimatedCostMultiplier: 2.0
      };
    case TranslationSpeedMode.ECONOMY:
      return {
        mode: TranslationSpeedMode.ECONOMY,
        sendInterval: 1500,
        textBufferDelay: 2000,
        estimatedCostMultiplier: 1.0
      };
    default:
      return {
        mode: TranslationSpeedMode.ULTRAFAST,
        sendInterval: 80,
        textBufferDelay: 2000,
        estimatedCostMultiplier: 15.0
      };
  }
};

export const DEFAULT_TRANSLATION_SPEED_SETTINGS = getTranslationSpeedSettings(
  TranslationSpeedMode.ULTRAFAST
);
