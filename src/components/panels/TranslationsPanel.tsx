import React from 'react';
import { Languages, Volume2 } from 'lucide-react';
import type { Translation } from '../../types';

type TranslationsPanelProps = {
  translations: Translation[];
  translationsRef: React.RefObject<HTMLDivElement | null>;
  isLocalPlaybackEnabled: boolean;
  toggleLocalPlayback: () => void;
};

export const TranslationsPanel: React.FC<TranslationsPanelProps> = ({
  translations,
  translationsRef,
  isLocalPlaybackEnabled,
  toggleLocalPlayback
}) => (
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
          <div className="mb-2">
            <p className="text-sm text-white leading-relaxed font-medium">
              {translation.translation}
            </p>
          </div>

          {translation.originalLanguageText && (
            <div className="border-t border-gray-600 pt-2">
              <p className="text-sm text-blue-300 leading-relaxed">
                {translation.originalLanguageText}
              </p>
            </div>
          )}

          {!translation.originalLanguageText && (
            <div className="border-t border-gray-600 pt-2">
              <p className="text-xs text-gray-500 italic">
                Re-translating to {translation.fromLanguage}...
              </p>
            </div>
          )}
        </div>
      ))}
      {translations.length === 0 && (
        <p className="text-gray-400 text-center py-6 text-sm">
          Translations will appear here...
        </p>
      )}
    </div>
  </div>
);
