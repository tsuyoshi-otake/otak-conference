import React from 'react';
import { getAvailableLanguageOptions } from '../../translation-prompts';

type SettingsPanelProps = {
  visible: boolean;
  username: string;
  setUsername: (value: string) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  myLanguage: string;
  setMyLanguage: (value: string) => void;
  isConnected: boolean;
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  visible,
  username,
  setUsername,
  apiKey,
  setApiKey,
  myLanguage,
  setMyLanguage,
  isConnected
}) => {
  if (!visible) {
    return null;
  }

  return (
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
  );
};
