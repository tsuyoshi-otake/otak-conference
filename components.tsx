import React, { useEffect, useRef } from 'react';
import { Mic, MicOff, Monitor, MonitorOff, Phone, PhoneOff, Settings, Users, Share2, Copy, Video, VideoOff, Sparkles, Sun, Heart, Hand, MessageCircle, Smile, ThumbsUp, Volume2, Headphones, Type, Languages, Filter } from 'lucide-react';
import { Participant, Translation, ChatMessage, AudioTranslation, VoiceSettings, ApiUsageStats, NoiseFilterSettings, TranslationSpeedMode, TranslationSpeedSettings } from './types';
import { getAvailableLanguageOptions } from './translation-prompts';
import { GenerativeArtBackgroundWebGL } from './generative-art-background-webgl';

interface ConferenceAppProps {
  apiKey: string;
  setApiKey: (value: string) => void;
  username: string;
  setUsername: (value: string) => void;
  roomId: string;
  isConnected: boolean;
  isInConference: boolean;
  isMuted: boolean;
  isScreenSharing: boolean;
  isCameraOn: boolean;
  isBackgroundBlur: boolean;
  setIsBackgroundBlur: (value: boolean) => void;
  isBeautyMode: boolean;
  setIsBeautyMode: (value: boolean) => void;
  brightness: number;
  setBrightness: (value: number) => void;
  showCameraSettings: boolean;
  setShowCameraSettings: (value: boolean) => void;
  myLanguage: string;
  setMyLanguage: (value: string) => void;
  translations: Translation[];
  participants: Participant[];
  showSettings: boolean;
  setShowSettings: (value: boolean) => void;
  showCopyModal: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  screenPreviewRef: React.RefObject<HTMLVideoElement | null>;
  remoteScreenSharer: string | null;
  isHandRaised: boolean;
  showChat: boolean;
  toggleChat: (value: boolean) => void;
  unreadMessageCount: number;
  showAudioSettings: boolean;
  setShowAudioSettings: (value: boolean) => void;
  audioInputDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  selectedMicrophone: string;
  selectedSpeaker: string;
  getAudioDevices: () => Promise<void>;
  changeMicrophone: (deviceId: string) => Promise<void>;
  changeSpeaker: (deviceId: string) => Promise<void>;
  sendRawAudio: boolean;
  toggleSendRawAudio: () => void;
  noiseFilterSettings: NoiseFilterSettings;
  updateNoiseFilterSettings: (settings: Partial<NoiseFilterSettings>) => void;
  toggleNoiseFilter: () => void;
  showReactions: boolean;
  showErrorModal: boolean;
  setShowErrorModal: (value: boolean) => void;
  errorMessage: string;
  setShowReactions: (value: boolean) => void;
  chatMessages: ChatMessage[];
  chatInput: string;
  setChatInput: (value: string) => void;
  startConference: () => void;
  endConference: () => void;
  shareRoomUrl: () => void;
  toggleMute: () => void;
  toggleScreenShare: () => void;
  toggleCamera: () => void;
  toggleHandRaise: () => void;
  sendReaction: (reaction: string) => void;
  sendChatMessage: () => void;
  
  // Audio translation props
  audioTranslations: AudioTranslation[];
  isAudioTranslationEnabled: boolean;
  voiceSettings: VoiceSettings;
  generateTranslationAudio: (translatedText: string, targetLanguage: string, originalText: string, fromLanguage: string) => Promise<void>;
  toggleAudioTranslation: () => void;
  updateVoiceSettings: (settings: Partial<VoiceSettings>) => void;

  // API usage tracking props
  apiUsageStats: ApiUsageStats;
  updateApiUsage: (inputTokens: { text: number; audio: number }, outputTokens: { text: number; audio: number }) => void;
  resetSessionUsage: () => void;
  
  // Local playback control props
  isLocalPlaybackEnabled: boolean;
  toggleLocalPlayback: () => void;
  
  // Gemini speaking state
  isGeminiSpeaking: boolean;
  
  // Translation speed settings
  translationSpeedMode: TranslationSpeedMode;
  translationSpeedSettings: TranslationSpeedSettings;
  updateTranslationSpeedMode: (mode: TranslationSpeedMode) => void;
}

export const ConferenceApp: React.FC<ConferenceAppProps> = ({
  apiKey, setApiKey,
  username, setUsername,
  roomId,
  isConnected,
  isInConference,
  isMuted,
  isScreenSharing,
  isCameraOn,
  isBackgroundBlur, setIsBackgroundBlur,
  isBeautyMode, setIsBeautyMode,
  brightness, setBrightness,
  showCameraSettings, setShowCameraSettings,
  myLanguage, setMyLanguage,
  translations,
  participants,
  showSettings, setShowSettings,
  showCopyModal,
  videoRef,
  canvasRef,
  screenPreviewRef,
  remoteScreenSharer,
  isHandRaised,
  showChat, toggleChat,
  unreadMessageCount,
  showAudioSettings, setShowAudioSettings,
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
  showReactions, setShowReactions,
  chatMessages,
  chatInput, setChatInput,
  startConference,
  endConference,
  shareRoomUrl,
  toggleMute,
  toggleScreenShare,
  toggleCamera,
  toggleHandRaise,
  sendReaction,
  sendChatMessage,
  
  // Audio translation props
  audioTranslations,
  isAudioTranslationEnabled,
  voiceSettings,
  generateTranslationAudio,
  toggleAudioTranslation,
  updateVoiceSettings,

  // API usage tracking props
  apiUsageStats,
  updateApiUsage,
  resetSessionUsage,

  // Local playback control props
  isLocalPlaybackEnabled,
  toggleLocalPlayback,

  // Error modal props
  showErrorModal,
  errorMessage,
  setShowErrorModal,
  
  // Gemini speaking state
  isGeminiSpeaking,
  
  // Translation speed settings
  translationSpeedMode,
  translationSpeedSettings,
  updateTranslationSpeedMode
}) => {
  // Ref for translations container to enable auto-scroll
  const translationsRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when translations update
  useEffect(() => {
    if (translationsRef.current) {
      translationsRef.current.scrollTop = translationsRef.current.scrollHeight;
    }
  }, [translations]);

  return (
    <div className="min-h-screen bg-gray-900 text-white relative">
      {/* Generative Art Background - GPU Accelerated with Gemini Avatar */}
      <GenerativeArtBackgroundWebGL
        isInConference={isInConference}
        onGeminiSpeaking={isGeminiSpeaking}
      />
      
      {/* Main Content Container - Add relative positioning and z-index */}
      <div className="relative z-10">
      {/* Header */}
      <header className="bg-gray-800 bg-opacity-90 backdrop-blur-sm border-b border-gray-700 p-3">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div>
              <h1 className="text-xl font-bold">otak-conference</h1>
              <p className="text-xs text-gray-400">
                A New Era of AI Translation: Powered by LLMs
                {process.env.REACT_APP_COMMIT_HASH && (
                  <span className="ml-2 text-gray-500">- {process.env.REACT_APP_COMMIT_HASH}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* API Usage Display */}
            <div className="hidden md:block text-xs text-gray-400 bg-gray-700 px-2 py-1 rounded">
              <div className="flex gap-3">
                <span>Sessions: {apiUsageStats.sessionCount}</span>
                <span>Session: ${apiUsageStats.sessionUsage.totalCost.toFixed(4)}</span>
                <span>Total: ${apiUsageStats.totalUsage.totalCost.toFixed(4)}</span>
              </div>
            </div>
            {/* Mobile version - simplified */}
            <div className="md:hidden text-xs text-gray-400 bg-gray-700 px-2 py-1 rounded">
              <span className="font-medium">S:{apiUsageStats.sessionCount} ${apiUsageStats.sessionUsage.totalCost.toFixed(3)}</span>
            </div>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Settings Panel */}
      {(showSettings || !username || !apiKey) && (
        <div className="bg-gray-800 bg-opacity-90 backdrop-blur-sm border-b border-gray-700 p-3">
          <div className="container mx-auto space-y-3">
            <form onSubmit={(e) => e.preventDefault()}>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                  disabled={isConnected}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Gemini API Key
                </label>
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your Gemini API key"
                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                  disabled={isConnected}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Your Language
                </label>
                <select
                  value={myLanguage}
                  onChange={(e) => setMyLanguage(e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                  disabled={isConnected}
                >
                  {getAvailableLanguageOptions().map(option => (
                    <option key={option.value} value={option.value}>
                      {option.nativeName} ({option.label})
                    </option>
                  ))}
                </select>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Screen Share Preview */}
      {(isScreenSharing || remoteScreenSharer) && (
        <div className="bg-gray-800 bg-opacity-90 backdrop-blur-sm border-b border-gray-700 p-3">
          <div className="container mx-auto">
            <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
              <Monitor className="w-4 h-4" />
              Screen Share Preview
              {remoteScreenSharer && (
                <span className="text-xs text-gray-400">
                  (from {participants.find(p => p.clientId === remoteScreenSharer)?.username || 'Unknown'})
                </span>
              )}
            </h3>
            <div className="relative bg-black rounded-lg overflow-hidden max-w-xl mx-auto">
              <video
                ref={screenPreviewRef}
                autoPlay
                muted
                playsInline
                controls={false}
                className="w-full h-auto max-h-72"
                style={{ backgroundColor: '#000', minHeight: '160px' }}
                onLoadedMetadata={() => console.log('Video metadata loaded in component')}
                onCanPlay={() => console.log('Video can play in component')}
                onError={(e) => console.error('Video error in component:', e)}
              />
              {/* Debug info overlay */}
              <div className="absolute top-1 left-1 bg-black bg-opacity-50 text-white text-xs p-1 rounded">
                {remoteScreenSharer ? 'Remote Screen Share' : 'Your Screen Share'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="container mx-auto p-3 grid grid-cols-1 lg:grid-cols-3 gap-3 pb-16">
        {/* Participants */}
        <div className="lg:col-span-1 bg-gray-800 bg-opacity-90 backdrop-blur-sm rounded-lg p-3 shadow-lg">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Users className="w-4 h-4" />
            Participants ({participants.length}/2)
          </h2>
          <div className="space-y-2">
            {participants.map(participant => {
              const isCurrentUser = participant.username === username;
              const showReaction = participant.reaction && participant.reactionTimestamp &&
                Date.now() - participant.reactionTimestamp < 3000;
              
              return (
                <div
                  key={participant.clientId}
                  className="p-2 bg-gray-700 rounded-lg flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs">
                      {participant.username}
                      {isCurrentUser && <span className="text-gray-400 ml-1">(You)</span>}
                    </span>
                    {participant.isSpeaking && (
                      <div title="Speaking">
                        <Mic className="w-3 h-3 text-green-500 animate-pulse" />
                      </div>
                    )}
                    {participant.isHandRaised && (
                      <Hand className="w-3 h-3 text-yellow-500" />
                    )}
                    {showReaction && (
                      <span className="text-sm animate-bounce">
                        {participant.reaction}
                      </span>
                    )}
                  </div>
                  <span className="text-xs bg-gray-600 px-1.5 py-0.5 rounded">
                    {participant.language}
                  </span>
                </div>
              );
            })}
            {participants.length === 0 && (
              <p className="text-gray-400 text-xs">No participants yet</p>
            )}
          </div>
        </div>

        {/* Translations */}
        <div className="lg:col-span-2 bg-gray-800 bg-opacity-90 backdrop-blur-sm rounded-lg p-3 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Languages className="w-4 h-4" />
              Translations
            </h2>
            <button
              onClick={toggleLocalPlayback}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                isLocalPlaybackEnabled
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-600 text-gray-300'
              }`}
              title={`${isLocalPlaybackEnabled ? 'Disable' : 'Enable'} local playback of Gemini responses`}
            >
              <Volume2 size={12} />
              {isLocalPlaybackEnabled ? 'Local ON' : 'Local OFF'}
            </button>
          </div>
          <div
            ref={translationsRef}
            className="space-y-2 h-[200px] overflow-y-auto custom-scrollbar"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#374151 #1f2937'
            }}
          >
            {translations.map(translation => (
              <div
                key={translation.id}
                className="p-3 bg-gray-700 rounded-lg"
              >
                <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                  <span>{translation.from}</span>
                  <span>{translation.timestamp}</span>
                </div>
                <p className="text-sm text-white leading-relaxed">
                  {translation.translation}
                </p>
              </div>
            ))}
            {translations.length === 0 && (
              <p className="text-gray-400 text-center py-6 text-sm">
                Translations will appear here...
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Footer Controls */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-800 bg-opacity-90 backdrop-blur-sm border-t border-gray-700 p-3 z-20">
        <div className="container mx-auto">
          {/* Mobile/Narrow Layout - Stack vertically */}
          <div className="md:hidden space-y-3">
            {/* Top row - Close Conference and Share buttons */}
            <div className="flex justify-between items-center">
              <div className="flex justify-start">
                {isInConference ? (
                  <button
                    onClick={endConference}
                    className="py-1.5 px-3 bg-red-600 hover:bg-red-700 rounded-lg text-sm transition-colors flex items-center gap-1.5"
                  >
                    <PhoneOff className="w-3 h-3" />
                    Close Conference
                  </button>
                ) : (
                  <button
                    onClick={startConference}
                    className="py-1.5 px-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-colors flex items-center gap-1.5"
                    disabled={!username || !apiKey}
                  >
                    <Phone className="w-3 h-3" />
                    Start Conference
                  </button>
                )}
              </div>
              
              <button
                onClick={shareRoomUrl}
                className="py-1.5 px-3 bg-green-600 hover:bg-green-700 rounded-lg text-sm transition-colors flex items-center gap-1.5"
              >
                <Share2 className="w-3 h-3" />
                Share
              </button>
            </div>
            
            {/* Bottom row - Media controls */}
            <div className="flex justify-center gap-1.5 flex-wrap">
              <div className="relative">
                <button
                  onClick={toggleMute}
                  disabled={!isInConference}
                  className={`p-2 rounded-full transition-colors ${
                    !isInConference ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                    isMuted ? 'bg-gray-700 hover:bg-gray-600' : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                
                <button
                  onClick={() => setShowAudioSettings(true)}
                  className="absolute -top-0.5 -right-0.5 p-0.5 bg-blue-600 hover:bg-blue-700 rounded-full transition-colors"
                >
                  <Settings className="w-2.5 h-2.5" />
                </button>
              </div>
              
              <button
                onClick={toggleScreenShare}
                disabled={!isInConference}
                className={`p-2 rounded-full transition-colors ${
                  !isInConference ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                  isScreenSharing ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
              </button>

              <div className="relative">
                <button
                  onClick={toggleCamera}
                  disabled={!isInConference}
                  className={`p-2 rounded-full transition-colors ${
                    !isInConference ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                    isCameraOn ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  {isCameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                </button>
                
                {isCameraOn && (
                  <button
                    onClick={() => setShowCameraSettings(true)}
                    className="absolute -top-0.5 -right-0.5 p-0.5 bg-blue-600 hover:bg-blue-700 rounded-full transition-colors"
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>

              {/* Hand Raise Button */}
              <button
                onClick={toggleHandRaise}
                disabled={!isInConference}
                className={`p-2 rounded-full transition-colors ${
                  !isInConference ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                  isHandRaised ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                <Hand className="w-4 h-4" />
              </button>

              {/* Reactions Button */}
              <button
                onClick={() => setShowReactions(!showReactions)}
                disabled={!isInConference}
                className={`p-2 rounded-full transition-colors ${
                  !isInConference ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                  'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                <Heart className="w-4 h-4" />
              </button>

              {/* Chat Button */}
              <div className="relative">
                <button
                  onClick={() => toggleChat(!showChat)}
                  disabled={!isInConference}
                  className={`p-2 rounded-full transition-colors ${
                    !isInConference ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                    showChat ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  <MessageCircle className="w-4 h-4" />
                </button>
                {/* Unread message badge */}
                {unreadMessageCount > 0 && !showChat && (
                  <div className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center animate-pulse">
                    {unreadMessageCount > 9 ? '9+' : unreadMessageCount}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Desktop/Wide Layout - Original 3-column grid */}
          <div className="hidden md:grid md:grid-cols-3 md:items-center">
            {/* Left side - Start/Close Conference */}
            <div className="flex justify-start">
              {isInConference ? (
                <button
                  onClick={endConference}
                  className="py-1.5 px-3 bg-red-600 hover:bg-red-700 rounded-lg text-sm transition-colors flex items-center gap-1.5"
                >
                  <PhoneOff className="w-3 h-3" />
                  Close Conference
                </button>
              ) : (
                <button
                  onClick={startConference}
                  className="py-1.5 px-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-colors flex items-center gap-1.5"
                  disabled={!username || !apiKey}
                >
                  <Phone className="w-3 h-3" />
                  Start Conference
                </button>
              )}
            </div>

            {/* Center - Media controls */}
            <div className="flex justify-center gap-3">
              <div className="relative">
                <button
                  onClick={toggleMute}
                  disabled={!isInConference}
                  className={`p-2 rounded-full transition-colors ${
                    !isInConference ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                    isMuted ? 'bg-gray-700 hover:bg-gray-600' : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                
                <button
                  onClick={() => setShowAudioSettings(true)}
                  className="absolute -top-0.5 -right-0.5 p-0.5 bg-blue-600 hover:bg-blue-700 rounded-full transition-colors"
                >
                  <Settings className="w-2.5 h-2.5" />
                </button>
              </div>
              
              <button
                onClick={toggleScreenShare}
                disabled={true}
                className="p-2 rounded-full transition-colors bg-gray-700 opacity-50 cursor-not-allowed"
              >
                {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
              </button>

              <div className="relative">
                <button
                  onClick={toggleCamera}
                  disabled={true}
                  className="p-2 rounded-full transition-colors bg-gray-700 opacity-50 cursor-not-allowed"
                >
                  {isCameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                </button>
                
                {false && (
                  <button
                    onClick={() => setShowCameraSettings(true)}
                    className="absolute -top-0.5 -right-0.5 p-0.5 bg-blue-600 hover:bg-blue-700 rounded-full transition-colors"
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>

              {/* Hand Raise Button */}
              <button
                onClick={toggleHandRaise}
                disabled={!isInConference}
                className={`p-2 rounded-full transition-colors ${
                  !isInConference ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                  isHandRaised ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                <Hand className="w-4 h-4" />
              </button>

              {/* Reactions Button */}
              <button
                onClick={() => setShowReactions(!showReactions)}
                disabled={!isInConference}
                className={`p-2 rounded-full transition-colors ${
                  !isInConference ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                  'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                <Heart className="w-4 h-4" />
              </button>

              {/* Chat Button */}
              <div className="relative">
                <button
                  onClick={() => toggleChat(!showChat)}
                  disabled={!isInConference}
                  className={`p-2 rounded-full transition-colors ${
                    !isInConference ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                    showChat ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  <MessageCircle className="w-4 h-4" />
                </button>
                {/* Unread message badge */}
                {unreadMessageCount > 0 && !showChat && (
                  <div className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center animate-pulse">
                    {unreadMessageCount > 9 ? '9+' : unreadMessageCount}
                  </div>
                )}
              </div>
            </div>

            {/* Right side - Share button */}
            <div className="flex justify-end">
              <button
                onClick={shareRoomUrl}
                className="py-1.5 px-3 bg-green-600 hover:bg-green-700 rounded-lg text-sm transition-colors flex items-center gap-1.5"
              >
                <Share2 className="w-3 h-3" />
                Share
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Copy Modal */}
      {showCopyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 bg-opacity-95 backdrop-blur-sm p-4 rounded-lg border border-gray-700 text-center shadow-xl">
            <Copy className="w-6 h-6 text-green-500 mx-auto mb-3" />
            <h3 className="text-base font-semibold mb-2">Room URL Copied!</h3>
            <p className="text-gray-400 text-sm">Share this URL with others to join the conference</p>
          </div>
        </div>
      )}

      {/* Camera Settings Modal */}
      {showCameraSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 bg-opacity-95 backdrop-blur-sm p-4 rounded-lg border border-gray-700 w-80 shadow-xl">
            <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Camera Settings
            </h3>
            
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isBackgroundBlur}
                  onChange={(e) => setIsBackgroundBlur(e.target.checked)}
                  className="rounded bg-gray-700 border-gray-600"
                />
                <span className="text-sm">Background Blur</span>
              </label>
              
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isBeautyMode}
                  onChange={(e) => setIsBeautyMode(e.target.checked)}
                  className="rounded bg-gray-700 border-gray-600"
                />
                <span className="text-sm">Beauty Mode</span>
              </label>
              
              <div>
                <label className="block text-xs font-medium mb-2 flex items-center gap-2">
                  <Sun className="w-3 h-3" />
                  Brightness
                  <span className="text-gray-400">({brightness}%)</span>
                </label>
                <input
                  type="range"
                  min="50"
                  max="150"
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                  className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>
              
              <button
                onClick={() => setShowCameraSettings(false)}
                className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audio Settings Modal */}
      {showAudioSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 bg-opacity-95 backdrop-blur-sm p-4 rounded-lg border border-gray-700 w-80 shadow-xl">
            <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
              <Headphones className="w-4 h-4" />
              Audio Settings
            </h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1 flex items-center gap-2">
                  <Mic className="w-3 h-3" />
                  Microphone
                </label>
                <select
                  value={selectedMicrophone}
                  onChange={(e) => changeMicrophone(e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                >
                  {audioInputDevices.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
                
                {/* Microphone transmission option - placed directly under microphone selection */}
                <div className="mt-2">
                  <label className="flex items-center text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={!sendRawAudio} // Inverted logic: UI shows "Send only translated audio"
                      onChange={() => toggleSendRawAudio()}
                      className="mr-2 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                    />
                    Send only translated audio (disable raw audio)
                  </label>
                </div>

                {/* Noise Filter Section */}
                <div className="mt-3 pt-3 border-t border-gray-600">
                  <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center text-xs font-medium">
                      <Filter className="w-3 h-3 mr-1" />
                      Noise Filter
                    </label>
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={noiseFilterSettings.enabled}
                        onChange={toggleNoiseFilter}
                        className="bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                      />
                      <span className="ml-2 text-xs text-gray-400">
                        {noiseFilterSettings.enabled ? 'ON' : 'OFF'}
                      </span>
                    </div>
                  </div>
                  
                  {noiseFilterSettings.enabled && (
                    <div className="space-y-2 ml-4 text-xs">
                      <div>
                        <label className="block text-gray-400 mb-1">
                          High-pass Filter ({noiseFilterSettings.highPassFrequency}Hz)
                        </label>
                        <input
                          type="range"
                          min="50"
                          max="300"
                          value={noiseFilterSettings.highPassFrequency}
                          onChange={(e) => updateNoiseFilterSettings({
                            highPassFrequency: Number(e.target.value)
                          })}
                          className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-gray-400 mb-1">
                          Low-pass Filter ({noiseFilterSettings.lowPassFrequency}Hz)
                        </label>
                        <input
                          type="range"
                          min="4000"
                          max="12000"
                          value={noiseFilterSettings.lowPassFrequency}
                          onChange={(e) => updateNoiseFilterSettings({
                            lowPassFrequency: Number(e.target.value)
                          })}
                          className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-gray-400 mb-1">
                          Compression Ratio ({noiseFilterSettings.compressionRatio.toFixed(1)})
                        </label>
                        <input
                          type="range"
                          min="1"
                          max="8"
                          step="0.5"
                          value={noiseFilterSettings.compressionRatio}
                          onChange={(e) => updateNoiseFilterSettings({
                            compressionRatio: Number(e.target.value)
                          })}
                          className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-medium mb-1 flex items-center gap-2">
                  <Volume2 className="w-3 h-3" />
                  Speaker
                </label>
                <select
                  value={selectedSpeaker}
                  onChange={(e) => changeSpeaker(e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                >
                  {audioOutputDevices.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Speaker ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Translation Speed Settings */}
              <div>
                <label className="block text-xs font-medium mb-1 flex items-center gap-2">
                  <Languages className="w-3 h-3" />
                  Translation Speed
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="radio"
                      name="translationSpeed"
                      value={TranslationSpeedMode.ECONOMY}
                      checked={translationSpeedMode === TranslationSpeedMode.ECONOMY}
                      onChange={(e) => updateTranslationSpeedMode(e.target.value as TranslationSpeedMode)}
                      className="text-blue-600 bg-gray-700 border-gray-600"
                    />
                    <span>Economy (Low Cost)</span>
                    <span className="text-gray-400 ml-auto">~4s delay</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="radio"
                      name="translationSpeed"
                      value={TranslationSpeedMode.BALANCED}
                      checked={translationSpeedMode === TranslationSpeedMode.BALANCED}
                      onChange={(e) => updateTranslationSpeedMode(e.target.value as TranslationSpeedMode)}
                      className="text-blue-600 bg-gray-700 border-gray-600"
                    />
                    <span>Balanced (2x Cost)</span>
                    <span className="text-gray-400 ml-auto">~2s delay</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="radio"
                      name="translationSpeed"
                      value={TranslationSpeedMode.REALTIME}
                      checked={translationSpeedMode === TranslationSpeedMode.REALTIME}
                      onChange={(e) => updateTranslationSpeedMode(e.target.value as TranslationSpeedMode)}
                      className="text-blue-600 bg-gray-700 border-gray-600"
                    />
                    <span>Real-time (5x Cost)</span>
                    <span className="text-gray-400 ml-auto">~1s delay</span>
                  </label>
                </div>
                {/* Cost estimation display */}
                <div className="mt-2 p-2 bg-gray-700 rounded text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Estimated hourly cost:</span>
                    <span className="text-yellow-400 font-medium">
                      ${(0.50 * translationSpeedSettings.estimatedCostMultiplier).toFixed(2)}/hour
                    </span>
                  </div>
                </div>
              </div>
              
              <button
                onClick={getAudioDevices}
                className="w-full py-1.5 px-3 bg-green-600 hover:bg-green-700 rounded-lg text-sm transition-colors mb-2"
              >
                Refresh Devices
              </button>
              
              {/* Debug info */}
              <div className="text-xs text-gray-400 mb-2">
                <p>Found {audioInputDevices.length} microphone(s), {audioOutputDevices.length} speaker(s)</p>
                {audioOutputDevices.length === 0 && (
                  <p className="text-yellow-400">
                    Note: Some browsers may not show all audio output devices due to security restrictions.
                  </p>
                )}
              </div>
              
              <button
                onClick={() => setShowAudioSettings(false)}
                className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reactions Popup */}
      {showReactions && isInConference && (
        <div className="fixed bottom-16 left-1/2 transform -translate-x-1/2 bg-gray-800 bg-opacity-95 backdrop-blur-sm p-3 rounded-lg border border-gray-700 flex gap-1.5 shadow-xl z-30">
          <button
            onClick={() => sendReaction('👍')}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors text-xl"
          >
            👍
          </button>
          <button
            onClick={() => sendReaction('❤️')}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors text-xl"
          >
            ❤️
          </button>
          <button
            onClick={() => sendReaction('😊')}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors text-xl"
          >
            😊
          </button>
          <button
            onClick={() => sendReaction('👏')}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors text-xl"
          >
            👏
          </button>
          <button
            onClick={() => sendReaction('🎉')}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors text-xl"
          >
            🎉
          </button>
        </div>
      )}

      {/* Chat Panel */}
      {showChat && isInConference && (
        <div className="fixed right-3 bottom-16 w-72 h-80 bg-gray-800 bg-opacity-95 backdrop-blur-sm rounded-lg border border-gray-700 flex flex-col shadow-xl z-30">
          <div className="p-3 border-b border-gray-700">
            <h3 className="text-base font-semibold flex items-center justify-between">
              <span className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4" />
                Chat
              </span>
              <button
                onClick={() => toggleChat(false)}
                className="text-gray-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </h3>
          </div>
          <div className="flex-1 p-3 overflow-y-auto">
            {chatMessages.length === 0 ? (
              <p className="text-gray-400 text-center text-sm">No messages yet...</p>
            ) : (
              <div className="space-y-2">
                {chatMessages.map(msg => {
                  const isOwnMessage = msg.from === username;
                  const readByOthers = msg.readBy?.filter(reader => reader !== msg.from) || [];
                  const allParticipantsCount = participants.length;
                  const otherParticipantsCount = allParticipantsCount - 1; // Exclude message sender
                  
                  return (
                    <div key={msg.id} className="p-2 bg-gray-700 rounded">
                      <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                        <span>{msg.from}</span>
                        <span>{msg.timestamp}</span>
                      </div>
                      <p className="text-xs">{msg.message}</p>
                      {/* Read status for own messages */}
                      {isOwnMessage && readByOthers.length > 0 && (
                        <div className="text-xs text-blue-400 mt-1 flex items-center gap-1">
                          <span>✓✓</span>
                          <span>
                            Read by {readByOthers.length}
                            {otherParticipantsCount > 0 && ` of ${otherParticipantsCount}`}
                          </span>
                        </div>
                      )}
                      {/* Unread indicator for own messages */}
                      {isOwnMessage && readByOthers.length === 0 && otherParticipantsCount > 0 && (
                        <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                          <span>✓</span>
                          <span>Delivered</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="p-3 border-t border-gray-700">
            <form onSubmit={(e) => { e.preventDefault(); sendChatMessage(); }} className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-sm"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Error Modal */}
      {showErrorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 bg-opacity-95 backdrop-blur-sm border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center">
                <span className="text-white text-lg font-bold">!</span>
              </div>
              <h3 className="text-lg font-semibold text-white">Error</h3>
            </div>
            <p className="text-gray-300 mb-6 leading-relaxed">
              {errorMessage}
            </p>
            <button
              onClick={() => setShowErrorModal(false)}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-colors font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Hidden video and canvas elements for video processing */}
      <video ref={videoRef} style={{ display: 'none' }} />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  );
};