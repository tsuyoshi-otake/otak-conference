import React from 'react';
import { Monitor } from 'lucide-react';
import type { Participant } from '../../types';

type ScreenSharePreviewProps = {
  isScreenSharing: boolean;
  remoteScreenSharer: string | null;
  participants: Participant[];
  screenPreviewRef: React.RefObject<HTMLVideoElement | null>;
};

export const ScreenSharePreview: React.FC<ScreenSharePreviewProps> = ({
  isScreenSharing,
  remoteScreenSharer,
  participants,
  screenPreviewRef
}) => {
  if (!isScreenSharing && !remoteScreenSharer) {
    return null;
  }

  const remoteName = participants.find(p => p.clientId === remoteScreenSharer)?.username || 'Unknown';

  return (
    <div className="bg-gray-800 bg-opacity-90 backdrop-blur-sm border-b border-gray-700 p-3">
      <div className="container mx-auto">
        <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Monitor className="w-4 h-4" />
          Screen Share Preview
          {remoteScreenSharer && (
            <span className="text-xs text-gray-400">
              (from {remoteName})
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
          <div className="absolute top-1 left-1 bg-black bg-opacity-50 text-white text-xs p-1 rounded">
            {remoteScreenSharer ? 'Remote Screen Share' : 'Your Screen Share'}
          </div>
        </div>
      </div>
    </div>
  );
};
