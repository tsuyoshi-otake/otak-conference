import { useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { debugError, debugLog } from '../debug-utils';
import { TranslationSpeedMode } from '../types';
import { getTranslationSpeedSettings } from './translationSpeed';
import { isLocalRuntime } from './utils';
import type { ConferenceRefs, ConferenceState } from './useConferenceState';

type PersistenceParams = {
  state: ConferenceState;
  refs: ConferenceRefs;
};

export const useConferencePersistence = ({ state, refs }: PersistenceParams) => {
  const {
    apiKey,
    setApiKey,
    username,
    setUsername,
    myLanguage,
    setMyLanguage,
    setRoomId,
    setShowSettings,
    selectedMicrophone,
    setSelectedMicrophone,
    selectedSpeaker,
    setSelectedSpeaker,
    sendRawAudio,
    setSendRawAudio,
    isLocalPlaybackEnabled,
    setIsLocalPlaybackEnabled,
    noiseFilterSettings,
    setNoiseFilterSettings,
    translationSpeedMode,
    setTranslationSpeedMode,
    setTranslationSpeedSettings,
    apiUsageStats,
    setApiUsageStats
  } = state;
  const { isLocalPlaybackEnabledRef } = refs;

  useEffect(() => {
    debugLog('[otak-conference] Loading settings from localStorage...');
    const storedSettings = loadStoredSettings();

    debugLog('[otak-conference] Saved API Key:', storedSettings.apiKey ? 'Found (hidden for security)' : 'Not found');
    debugLog('[otak-conference] Saved Username:', storedSettings.username);
    debugLog('[otak-conference] Saved Language:', storedSettings.language);

    const resolvedApiKey = resolveApiKey(storedSettings.apiKey);
    if (resolvedApiKey) {
      setApiKey(resolvedApiKey);
    }

    if (storedSettings.username) {
      setUsername(storedSettings.username);
    }
    if (storedSettings.language) {
      setMyLanguage(storedSettings.language);
    }
    if (storedSettings.microphone) {
      setSelectedMicrophone(storedSettings.microphone);
    }
    if (storedSettings.speaker) {
      setSelectedSpeaker(storedSettings.speaker);
    }

    const sendRawAudioValue = parseStoredBoolean(storedSettings.sendRawAudio);
    if (sendRawAudioValue !== null) {
      setSendRawAudio(sendRawAudioValue);
    }

    const localPlaybackEnabled = parseStoredBoolean(storedSettings.localPlayback);
    if (localPlaybackEnabled !== null) {
      setIsLocalPlaybackEnabled(localPlaybackEnabled);
      isLocalPlaybackEnabledRef.current = localPlaybackEnabled;
    }

    const parsedNoiseFilter = parseNoiseFilterSettings(storedSettings.noiseFilter);
    if (parsedNoiseFilter) {
      setNoiseFilterSettings(parsedNoiseFilter);
    }

    const parsedSpeedMode = parseTranslationSpeedMode(storedSettings.speedMode);
    if (parsedSpeedMode) {
      setTranslationSpeedMode(parsedSpeedMode);
      setTranslationSpeedSettings(getTranslationSpeedSettings(parsedSpeedMode));
    }

    applyStoredApiUsage(storedSettings.usage, storedSettings.sessionCount, setApiUsageStats);

    const roomIdFromUrl = getRoomIdFromUrl(window.location.search);
    if (roomIdFromUrl) {
      setRoomId(roomIdFromUrl);
      setShowSettings(false);
    } else {
      setRoomId(uuidv4());
    }
  }, [
    setApiKey,
    setUsername,
    setMyLanguage,
    setRoomId,
    setShowSettings,
    setSelectedMicrophone,
    setSelectedSpeaker,
    setSendRawAudio,
    setIsLocalPlaybackEnabled,
    isLocalPlaybackEnabledRef,
    setNoiseFilterSettings,
    setTranslationSpeedMode,
    setTranslationSpeedSettings,
    setApiUsageStats
  ]);

  useEffect(() => {
    debugLog('[otak-conference] Saving API Key to localStorage:', apiKey ? 'Key provided (hidden for security)' : 'Empty key');
    localStorage.setItem('geminiApiKey', apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem('username', username);
  }, [username]);

  useEffect(() => {
    localStorage.setItem('myLanguage', myLanguage);
  }, [myLanguage]);

  useEffect(() => {
    if (selectedMicrophone) {
      localStorage.setItem('selectedMicrophone', selectedMicrophone);
    }
  }, [selectedMicrophone]);

  useEffect(() => {
    if (selectedSpeaker) {
      localStorage.setItem('selectedSpeaker', selectedSpeaker);
    }
  }, [selectedSpeaker]);

  useEffect(() => {
    localStorage.setItem('noiseFilterSettings', JSON.stringify(noiseFilterSettings));
  }, [noiseFilterSettings]);

  useEffect(() => {
    if (apiUsageStats.sessionCount !== undefined) {
      localStorage.setItem('geminiSessionCount', apiUsageStats.sessionCount.toString());
    }
  }, [apiUsageStats.sessionCount]);

  useEffect(() => {
    if (apiUsageStats.totalUsage) {
      localStorage.setItem('geminiApiUsage', JSON.stringify(apiUsageStats.totalUsage));
    }
  }, [apiUsageStats.totalUsage]);

  useEffect(() => {
    localStorage.setItem('sendRawAudio', sendRawAudio.toString());
  }, [sendRawAudio]);

  useEffect(() => {
    localStorage.setItem('isLocalPlaybackEnabled', isLocalPlaybackEnabled.toString());
  }, [isLocalPlaybackEnabled]);

  useEffect(() => {
    localStorage.setItem('translationSpeedMode', translationSpeedMode);
  }, [translationSpeedMode]);
};

type StoredSettings = {
  apiKey: string | null;
  username: string | null;
  language: string | null;
  microphone: string | null;
  localPlayback: string | null;
  speaker: string | null;
  sendRawAudio: string | null;
  noiseFilter: string | null;
  usage: string | null;
  sessionCount: string | null;
  speedMode: string | null;
};

const loadStoredSettings = (): StoredSettings => ({
  apiKey: localStorage.getItem('geminiApiKey'),
  username: localStorage.getItem('username'),
  language: localStorage.getItem('myLanguage'),
  microphone: localStorage.getItem('selectedMicrophone'),
  localPlayback: localStorage.getItem('isLocalPlaybackEnabled'),
  speaker: localStorage.getItem('selectedSpeaker'),
  sendRawAudio: localStorage.getItem('sendRawAudio'),
  noiseFilter: localStorage.getItem('noiseFilterSettings'),
  usage: localStorage.getItem('geminiApiUsage'),
  sessionCount: localStorage.getItem('geminiSessionCount'),
  speedMode: localStorage.getItem('translationSpeedMode')
});

const resolveApiKey = (storedApiKey: string | null): string | null => {
  if (storedApiKey) {
    return storedApiKey;
  }

  const envApiKey = process.env.GEMINI_API_KEY || '';
  if (envApiKey && isLocalRuntime()) {
    localStorage.setItem('geminiApiKey', envApiKey);
    return envApiKey;
  }

  return null;
};

const parseStoredBoolean = (value: string | null): boolean | null => {
  if (value === null) {
    return null;
  }
  return value === 'true';
};

const parseNoiseFilterSettings = (storedNoiseFilter: string | null): ConferenceState['noiseFilterSettings'] | null => {
  if (!storedNoiseFilter) {
    return null;
  }
  try {
    return JSON.parse(storedNoiseFilter);
  } catch (error) {
    debugError('Failed to parse stored noise filter settings:', error);
    return null;
  }
};

const parseTranslationSpeedMode = (storedSpeedMode: string | null): TranslationSpeedMode | null => {
  if (!storedSpeedMode) {
    return null;
  }
  return storedSpeedMode as TranslationSpeedMode;
};

const applyStoredApiUsage = (
  storedUsage: string | null,
  storedSessionCount: string | null,
  setApiUsageStats: ConferenceState['setApiUsageStats']
): void => {
  if (storedUsage) {
    try {
      const parsedUsage = JSON.parse(storedUsage);
      const sessionCount = storedSessionCount ? parseInt(storedSessionCount, 10) : 0;
      setApiUsageStats(prev => ({
        ...prev,
        totalUsage: parsedUsage,
        sessionCount: sessionCount
      }));
    } catch (error) {
      debugError('Failed to parse stored API usage:', error);
    }
    return;
  }

  if (storedSessionCount) {
    try {
      const sessionCount = parseInt(storedSessionCount, 10);
      setApiUsageStats(prev => ({
        ...prev,
        sessionCount: sessionCount
      }));
    } catch (error) {
      debugError('Failed to parse stored session count:', error);
    }
  }
};

const getRoomIdFromUrl = (search: string): string | null => {
  const urlParams = new URLSearchParams(search);
  const queryRoomId = urlParams.get('roomId');
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (queryRoomId && uuidRegex.test(queryRoomId)) {
    return queryRoomId;
  }
  return null;
};
