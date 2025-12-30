import React from 'react';
import {
  Hand,
  Heart,
  MessageCircle,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Phone,
  PhoneOff,
  Settings,
  Share2,
  Sparkles,
  Video,
  VideoOff
} from 'lucide-react';
import type { FooterControlsProps } from './types';

export const FooterControlsMobile: React.FC<FooterControlsProps> = ({
  apiKey,
  username,
  isInConference,
  isMuted,
  isScreenSharing,
  isCameraOn,
  isHandRaised,
  showChat,
  showReactions,
  unreadMessageCount,
  setShowAudioSettings,
  setShowCameraSettings,
  setShowReactions,
  toggleChat,
  startConference,
  endConference,
  shareRoomUrl,
  toggleMute,
  toggleScreenShare,
  toggleCamera,
  toggleHandRaise
}) => (
  <div className="md:hidden space-y-3">
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
        {unreadMessageCount > 0 && !showChat && (
          <div className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center animate-pulse">
            {unreadMessageCount > 9 ? '9+' : unreadMessageCount}
          </div>
        )}
      </div>
    </div>
  </div>
);
