import { useCallback, useEffect } from 'react';
import { debugLog, debugWarn } from '../../debug-utils';
import type { ConferenceRefs, ConferenceState } from '../useConferenceState';

type AudioDevicesParams = {
  state: Pick<
    ConferenceState,
    | 'selectedMicrophone'
    | 'setSelectedMicrophone'
    | 'selectedSpeaker'
    | 'setSelectedSpeaker'
    | 'setAudioInputDevices'
    | 'setAudioOutputDevices'
    | 'isInConference'
  >;
  refs: Pick<ConferenceRefs, 'audioContextRef' | 'localStreamRef'>;
  getAudioInputStream: (audioConstraints: MediaTrackConstraints | boolean) => Promise<MediaStream>;
  replaceLocalAudioInputStream: (stream: MediaStream) => void;
};

export const useAudioDevices = ({
  state,
  refs,
  getAudioInputStream,
  replaceLocalAudioInputStream
}: AudioDevicesParams) => {
  const {
    selectedMicrophone,
    setSelectedMicrophone,
    selectedSpeaker,
    setSelectedSpeaker,
    setAudioInputDevices,
    setAudioOutputDevices,
    isInConference
  } = state;
  const { audioContextRef, localStreamRef } = refs;

  const getAudioDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        debugWarn('MediaDevices API not available');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach(track => track.stop());
      } catch (permissionError) {
        debugWarn('Media permission not granted, device labels may be limited:', permissionError);
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!devices) {
        debugWarn('No devices returned from enumerateDevices');
        return;
      }

      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      const audioOutputs = devices.filter(device => device.kind === 'audiooutput');

      debugLog('Available audio inputs:', audioInputs);
      debugLog('Available audio outputs:', audioOutputs);

      setAudioInputDevices(audioInputs);
      setAudioOutputDevices(audioOutputs);

      if (selectedMicrophone) {
        const micExists = audioInputs.some(device => device.deviceId === selectedMicrophone);
        if (!micExists && audioInputs.length > 0) {
          debugLog('[AUDIO] Saved microphone not found, selecting default');
          setSelectedMicrophone(audioInputs[0].deviceId);
        }
      } else if (audioInputs.length > 0) {
        setSelectedMicrophone(audioInputs[0].deviceId);
      }

      if (selectedSpeaker) {
        const speakerExists = audioOutputs.some(device => device.deviceId === selectedSpeaker);
        if (!speakerExists && audioOutputs.length > 0) {
          debugLog('[AUDIO] Saved speaker not found, selecting default');
          setSelectedSpeaker(audioOutputs[0].deviceId);
        }
      } else if (audioOutputs.length > 0) {
        setSelectedSpeaker(audioOutputs[0].deviceId);
      }
    } catch (error) {
      console.error('Error getting audio devices:', error);
    }
  }, [
    selectedMicrophone,
    selectedSpeaker,
    setAudioInputDevices,
    setAudioOutputDevices,
    setSelectedMicrophone,
    setSelectedSpeaker
  ]);

  useEffect(() => {
    getAudioDevices();
  }, [getAudioDevices]);

  const changeMicrophone = useCallback(async (deviceId: string) => {
    setSelectedMicrophone(deviceId);

    if (isInConference && localStreamRef.current) {
      try {
        const rawNewAudioStream = await getAudioInputStream({
          deviceId: { exact: deviceId }
        });
        replaceLocalAudioInputStream(rawNewAudioStream);
      } catch (error) {
        console.error('Error changing microphone:', error);
        alert('Failed to change microphone. Please check permissions.');
      }
    }
  }, [
    getAudioInputStream,
    isInConference,
    localStreamRef,
    replaceLocalAudioInputStream,
    setSelectedMicrophone
  ]);

  const changeSpeaker = useCallback(async (deviceId: string) => {
    setSelectedSpeaker(deviceId);

    debugLog(`[Audio] Changing speaker to device: ${deviceId}`);

    try {
      const audioElements = document.querySelectorAll('audio');
      debugLog(`[Audio] Found ${audioElements.length} existing audio elements`);

      for (const audio of audioElements) {
        if ('setSinkId' in audio) {
          try {
            await (audio as any).setSinkId(deviceId);
            debugLog('[Audio] Successfully set output device for existing audio element');
          } catch (error) {
            console.warn('[Audio] Could not set output device for existing audio element:', error);
          }
        }
      }

      if (audioContextRef.current && 'setSinkId' in audioContextRef.current.destination) {
        try {
          await (audioContextRef.current.destination as any).setSinkId(deviceId);
          debugLog('[Audio] Successfully set output device for audio context');
        } catch (error) {
          console.warn('[Audio] Could not set output device for audio context:', error);
        }
      }

      debugLog(`[Audio] Speaker device change completed for device: ${deviceId}`);
    } catch (error) {
      console.warn('[Audio] Speaker change not fully supported:', error);
    }
  }, [audioContextRef, setSelectedSpeaker]);

  return { getAudioDevices, changeMicrophone, changeSpeaker };
};
