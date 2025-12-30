import React from 'react';
import { MessageCircle } from 'lucide-react';
import type { ChatMessage, Participant } from '../../types';

type ChatPanelProps = {
  showChat: boolean;
  isInConference: boolean;
  chatMessages: ChatMessage[];
  chatInput: string;
  setChatInput: (value: string) => void;
  sendChatMessage: () => void;
  toggleChat: (value: boolean) => void;
  participants: Participant[];
  username: string;
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  showChat,
  isInConference,
  chatMessages,
  chatInput,
  setChatInput,
  sendChatMessage,
  toggleChat,
  participants,
  username
}) => {
  if (!showChat || !isInConference) {
    return null;
  }

  return (
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
            ?
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
              const otherParticipantsCount = participants.length - 1;

              return (
                <div key={msg.id} className="p-2 bg-gray-700 rounded">
                  <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                    <span>{msg.from}</span>
                    <span>{msg.timestamp}</span>
                  </div>
                  <p className="text-xs">{msg.message}</p>
                  {isOwnMessage && readByOthers.length > 0 && (
                    <div className="text-xs text-blue-400 mt-1 flex items-center gap-1">
                      <span>??</span>
                      <span>
                        Read by {readByOthers.length}
                        {otherParticipantsCount > 0 && ` of ${otherParticipantsCount}`}
                      </span>
                    </div>
                  )}
                  {isOwnMessage && readByOthers.length === 0 && otherParticipantsCount > 0 && (
                    <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                      <span>?</span>
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
  );
};
