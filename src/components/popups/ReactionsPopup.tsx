import React from 'react';

type ReactionsPopupProps = {
  showReactions: boolean;
  isInConference: boolean;
  sendReaction: (reaction: string) => void;
};

export const ReactionsPopup: React.FC<ReactionsPopupProps> = ({
  showReactions,
  isInConference,
  sendReaction
}) => {
  if (!showReactions || !isInConference) {
    return null;
  }

  return (
    <div className="fixed bottom-16 left-1/2 transform -translate-x-1/2 bg-gray-800 bg-opacity-95 backdrop-blur-sm p-3 rounded-lg border border-gray-700 flex gap-1.5 shadow-xl z-30">
      <button
        onClick={() => sendReaction('??')}
        className="p-1.5 hover:bg-gray-700 rounded transition-colors text-xl"
      >
        ??
      </button>
      <button
        onClick={() => sendReaction('??')}
        className="p-1.5 hover:bg-gray-700 rounded transition-colors text-xl"
      >
        ??
      </button>
      <button
        onClick={() => sendReaction('??')}
        className="p-1.5 hover:bg-gray-700 rounded transition-colors text-xl"
      >
        ??
      </button>
      <button
        onClick={() => sendReaction('??')}
        className="p-1.5 hover:bg-gray-700 rounded transition-colors text-xl"
      >
        ??
      </button>
      <button
        onClick={() => sendReaction('??')}
        className="p-1.5 hover:bg-gray-700 rounded transition-colors text-xl"
      >
        ??
      </button>
    </div>
  );
};
