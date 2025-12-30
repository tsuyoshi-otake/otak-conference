import { useCallback } from 'react';
import { debugLog } from '../../debug-utils';
import type { ConferenceRefs, ConferenceState } from '../useConferenceState';

type MediaControlsParams = {
  state: Pick<
    ConferenceState,
    | 'isScreenSharing'
    | 'setIsScreenSharing'
    | 'isCameraOn'
    | 'setIsCameraOn'
    | 'isBackgroundBlur'
    | 'isBeautyMode'
    | 'brightness'
    | 'remoteScreenSharer'
  >;
  refs: Pick<
    ConferenceRefs,
    | 'screenStreamRef'
    | 'cameraStreamRef'
    | 'screenPreviewRef'
    | 'videoRef'
    | 'canvasRef'
    | 'peerConnectionsRef'
  >;
};

export const useMediaControls = ({ state, refs }: MediaControlsParams) => {
  const {
    isScreenSharing,
    setIsScreenSharing,
    isCameraOn,
    setIsCameraOn,
    isBackgroundBlur,
    isBeautyMode,
    brightness,
    remoteScreenSharer
  } = state;
  const {
    screenStreamRef,
    cameraStreamRef,
    screenPreviewRef,
    videoRef,
    canvasRef,
    peerConnectionsRef
  } = refs;

  const toggleScreenShare = useCallback(async () => {
    if (!isScreenSharing) {
      try {
        screenStreamRef.current = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 30, max: 30 }
          },
          audio: false
        });

        debugLog('Screen share stream obtained:', screenStreamRef.current);
        debugLog('Video tracks:', screenStreamRef.current.getVideoTracks());
        debugLog('Stream active:', screenStreamRef.current.active);

        const videoTrack = screenStreamRef.current.getVideoTracks()[0];
        if (!videoTrack) {
          throw new Error('No video track found in screen share stream');
        }
        debugLog('Video track enabled:', videoTrack.enabled);
        debugLog('Video track readyState:', videoTrack.readyState);

        Object.values(peerConnectionsRef.current).forEach(pc => {
          if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(track => {
              debugLog(`Adding ${track.kind} track to peer connection`);
              try {
                pc.addTrack(track, screenStreamRef.current!);
                debugLog('Track added successfully');
              } catch (error) {
                console.error('Error adding track:', error);
              }
            });
          }
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        if (screenPreviewRef.current && screenStreamRef.current) {
          debugLog('Setting up screen preview');
          screenPreviewRef.current.srcObject = null;
          screenPreviewRef.current.muted = true;
          screenPreviewRef.current.playsInline = true;
          screenPreviewRef.current.autoplay = true;

          screenPreviewRef.current.onloadedmetadata = () => {
            debugLog('Video metadata loaded, dimensions:',
              screenPreviewRef.current?.videoWidth, 'x', screenPreviewRef.current?.videoHeight);
            if (screenPreviewRef.current) {
              screenPreviewRef.current.style.display = 'none';
              setTimeout(() => {
                if (screenPreviewRef.current) {
                  screenPreviewRef.current.style.display = 'block';
                }
              }, 10);
            }
          };

          screenPreviewRef.current.oncanplay = () => {
            debugLog('Video can play');
          };

          screenPreviewRef.current.onplaying = () => {
            debugLog('Video is playing');
          };

          screenPreviewRef.current.onerror = (error) => {
            console.error('Video element error:', error);
          };

          screenPreviewRef.current.srcObject = screenStreamRef.current;

          setTimeout(async () => {
            if (screenPreviewRef.current) {
              try {
                await screenPreviewRef.current.play();
                debugLog('Video playing successfully');
              } catch (playError) {
                console.error('Error playing video:', playError);
                screenPreviewRef.current.muted = true;
                screenPreviewRef.current.play().catch(e => console.error('Second play attempt failed:', e));
              }
            }
          }, 100);
        }

        setIsScreenSharing(true);

        videoTrack.onended = () => {
          debugLog('Screen share ended by user');
          if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => {
              track.stop();
            });
            screenStreamRef.current = null;
          }
          if (screenPreviewRef.current && !remoteScreenSharer) {
            screenPreviewRef.current.srcObject = null;
          }
          setIsScreenSharing(false);
        };
      } catch (error) {
        console.error('Error starting screen share:', error);
        alert('Failed to start screen sharing. Please check permissions.');
        setIsScreenSharing(false);
      }
    } else {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => {
          track.stop();
          debugLog('Stopped track:', track.kind);
        });
        screenStreamRef.current = null;
      }
      if (screenPreviewRef.current && !remoteScreenSharer) {
        screenPreviewRef.current.srcObject = null;
      }
      setIsScreenSharing(false);
      debugLog('Screen sharing stopped');
    }
  }, [
    isScreenSharing,
    peerConnectionsRef,
    remoteScreenSharer,
    screenPreviewRef,
    screenStreamRef,
    setIsScreenSharing
  ]);

  const applyVideoEffects = useCallback(() => {
    if (!cameraStreamRef.current || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const applyEffects = () => {
      ctx.filter = `brightness(${brightness}%)`;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (isBackgroundBlur) {
        ctx.filter += ' blur(2px)';
      }

      if (isBeautyMode) {
        ctx.filter += ' contrast(1.1) saturate(1.1)';
      }

      requestAnimationFrame(applyEffects);
    };

    applyEffects();
  }, [brightness, cameraStreamRef, canvasRef, isBackgroundBlur, isBeautyMode, videoRef]);

  const toggleCamera = useCallback(async () => {
    if (!isCameraOn) {
      try {
        cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });

        if (videoRef.current) {
          videoRef.current.srcObject = cameraStreamRef.current;
          videoRef.current.play();
        }

        setIsCameraOn(true);

        if (isBackgroundBlur || isBeautyMode || brightness !== 100) {
          applyVideoEffects();
        }
      } catch (error) {
        console.error('Error accessing camera:', error);
        alert('Failed to access camera. Please check permissions.');
      }
    } else {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        cameraStreamRef.current = null;
      }
      setIsCameraOn(false);
    }
  }, [
    applyVideoEffects,
    brightness,
    cameraStreamRef,
    isBackgroundBlur,
    isBeautyMode,
    isCameraOn,
    setIsCameraOn,
    videoRef
  ]);

  return { toggleScreenShare, toggleCamera, applyVideoEffects };
};
