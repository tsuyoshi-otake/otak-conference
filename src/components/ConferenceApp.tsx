import React, { useEffect, useRef } from 'react';
import { GenerativeArtBackgroundWebGL } from '../generative-art-background-webgl';
import type { ConferenceAppProps } from './types';
import { ConferenceHeader } from './ConferenceHeader';
import { FooterControls } from './footer/FooterControls';
import { CopyModal } from './modals/CopyModal';
import { CameraSettingsModal } from './modals/CameraSettingsModal';
import { AudioSettingsModal } from './modals/AudioSettingsModal';
import { ErrorModal } from './modals/ErrorModal';
import { ScreenSharePreview } from './panels/ScreenSharePreview';
import { SettingsPanel } from './panels/SettingsPanel';
import { ParticipantsPanel } from './panels/ParticipantsPanel';
import { TranslationsPanel } from './panels/TranslationsPanel';
import { ReactionsPopup } from './popups/ReactionsPopup';
import { ChatPanel } from './panels/ChatPanel';

export const ConferenceApp: React.FC<ConferenceAppProps> = ({
  apiKey,
  setApiKey,
  username,
  setUsername,
  isConnected,
  isInConference,
  isMuted,
  isScreenSharing,
  isCameraOn,
  isBackgroundBlur,
  setIsBackgroundBlur,
  isBeautyMode,
  setIsBeautyMode,
  brightness,
  setBrightness,
  showCameraSettings,
  setShowCameraSettings,
  myLanguage,
  setMyLanguage,
  translations,
  participants,
  showSettings,
  setShowSettings,
  showCopyModal,
  videoRef,
  canvasRef,
  screenPreviewRef,
  remoteScreenSharer,
  isHandRaised,
  showChat,
  toggleChat,
  unreadMessageCount,
  showAudioSettings,
  setShowAudioSettings,
  audioInputDevices,
  audioOutputDevices,
  selectedMicrophone,
  selectedSpeaker,
  getAudioDevices,
  changeMicrophone,
  changeSpeaker,
  sendRawAudio,
  toggleSendRawAudio,
  noiseFilterSettings,
  updateNoiseFilterSettings,
  toggleNoiseFilter,
  showReactions,
  showErrorModal,
  setShowErrorModal,
  errorMessage,
  setShowReactions,
  chatMessages,
  chatInput,
  setChatInput,
  startConference,
  endConference,
  shareRoomUrl,
  toggleMute,
  toggleScreenShare,
  toggleCamera,
  toggleHandRaise,
  sendReaction,
  sendChatMessage,
  apiUsageStats,
  isLocalPlaybackEnabled,
  toggleLocalPlayback,
  isGeminiSpeaking,
  translationSpeedMode,
  translationSpeedSettings,
  updateTranslationSpeedMode
}) => {
  const translationsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (translationsRef.current) {
      translationsRef.current.scrollTop = translationsRef.current.scrollHeight;
    }
  }, [translations]);

  const showSettingsPanel = showSettings || !username || !apiKey;

  return (
    <div className="min-h-screen bg-gray-900 text-white relative">
      <GenerativeArtBackgroundWebGL
        isInConference={isInConference}
        onGeminiSpeaking={isGeminiSpeaking}
      />

      <div className="relative z-10">
        <ConferenceHeader
          apiUsageStats={apiUsageStats}
          showSettings={showSettings}
          setShowSettings={setShowSettings}
        />

        <SettingsPanel
          visible={showSettingsPanel}
          username={username}
          setUsername={setUsername}
          apiKey={apiKey}
          setApiKey={setApiKey}
          myLanguage={myLanguage}
          setMyLanguage={setMyLanguage}
          isConnected={isConnected}
        />

        <ScreenSharePreview
          isScreenSharing={isScreenSharing}
          remoteScreenSharer={remoteScreenSharer}
          participants={participants}
          screenPreviewRef={screenPreviewRef}
        />

        <div className="container mx-auto p-3 grid grid-cols-1 lg:grid-cols-3 gap-3 pb-16">
          <ParticipantsPanel participants={participants} username={username} />
          <TranslationsPanel
            translations={translations}
            translationsRef={translationsRef}
            isLocalPlaybackEnabled={isLocalPlaybackEnabled}
            toggleLocalPlayback={toggleLocalPlayback}
          />
        </div>

        <FooterControls
          apiKey={apiKey}
          username={username}
          isInConference={isInConference}
          isMuted={isMuted}
          isScreenSharing={isScreenSharing}
          isCameraOn={isCameraOn}
          isHandRaised={isHandRaised}
          showChat={showChat}
          showReactions={showReactions}
          unreadMessageCount={unreadMessageCount}
          setShowAudioSettings={setShowAudioSettings}
          setShowCameraSettings={setShowCameraSettings}
          setShowReactions={setShowReactions}
          toggleChat={toggleChat}
          startConference={startConference}
          endConference={endConference}
          shareRoomUrl={shareRoomUrl}
          toggleMute={toggleMute}
          toggleScreenShare={toggleScreenShare}
          toggleCamera={toggleCamera}
          toggleHandRaise={toggleHandRaise}
        />

        <CopyModal showCopyModal={showCopyModal} />

        <CameraSettingsModal
          showCameraSettings={showCameraSettings}
          setShowCameraSettings={setShowCameraSettings}
          isBackgroundBlur={isBackgroundBlur}
          setIsBackgroundBlur={setIsBackgroundBlur}
          isBeautyMode={isBeautyMode}
          setIsBeautyMode={setIsBeautyMode}
          brightness={brightness}
          setBrightness={setBrightness}
        />

        <AudioSettingsModal
          showAudioSettings={showAudioSettings}
          setShowAudioSettings={setShowAudioSettings}
          audioInputDevices={audioInputDevices}
          audioOutputDevices={audioOutputDevices}
          selectedMicrophone={selectedMicrophone}
          selectedSpeaker={selectedSpeaker}
          changeMicrophone={changeMicrophone}
          changeSpeaker={changeSpeaker}
          getAudioDevices={getAudioDevices}
          sendRawAudio={sendRawAudio}
          toggleSendRawAudio={toggleSendRawAudio}
          noiseFilterSettings={noiseFilterSettings}
          updateNoiseFilterSettings={updateNoiseFilterSettings}
          toggleNoiseFilter={toggleNoiseFilter}
          translationSpeedMode={translationSpeedMode}
          translationSpeedSettings={translationSpeedSettings}
          updateTranslationSpeedMode={updateTranslationSpeedMode}
        />

        <ReactionsPopup
          showReactions={showReactions}
          isInConference={isInConference}
          sendReaction={sendReaction}
        />

        <ChatPanel
          showChat={showChat}
          isInConference={isInConference}
          chatMessages={chatMessages}
          chatInput={chatInput}
          setChatInput={setChatInput}
          sendChatMessage={sendChatMessage}
          toggleChat={toggleChat}
          participants={participants}
          username={username}
        />

        <ErrorModal
          showErrorModal={showErrorModal}
          errorMessage={errorMessage}
          setShowErrorModal={setShowErrorModal}
        />

        <video ref={videoRef} style={{ display: 'none' }} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  );
};
