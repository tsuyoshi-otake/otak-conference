import React from 'react';
import { Settings } from 'lucide-react';
import type { ApiUsageStats } from '../types';

type ConferenceHeaderProps = {
  apiUsageStats: ApiUsageStats;
  showSettings: boolean;
  setShowSettings: (value: boolean) => void;
};

export const ConferenceHeader: React.FC<ConferenceHeaderProps> = ({
  apiUsageStats,
  showSettings,
  setShowSettings
}) => (
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
        <div className="hidden md:block text-xs text-gray-400 bg-gray-700 px-2 py-1 rounded">
          <div className="flex gap-3">
            <span>Sessions: {apiUsageStats.sessionCount}</span>
            <span>Session: ${apiUsageStats.sessionUsage.totalCost.toFixed(4)}</span>
            <span>Total: ${apiUsageStats.totalUsage.totalCost.toFixed(4)}</span>
          </div>
        </div>
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
);
