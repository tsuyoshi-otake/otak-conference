import React from 'react';
import { Hand, Mic, Users } from 'lucide-react';
import type { Participant } from '../../types';

type ParticipantsPanelProps = {
  participants: Participant[];
  username: string;
};

export const ParticipantsPanel: React.FC<ParticipantsPanelProps> = ({ participants, username }) => (
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
);
