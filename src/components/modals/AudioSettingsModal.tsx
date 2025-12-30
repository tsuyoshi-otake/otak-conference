import React from 'react';
import { Filter, Headphones, Languages, Mic, Volume2 } from 'lucide-react';
import { TranslationSpeedMode } from '../../types';
import type { NoiseFilterSettings, TranslationSpeedSettings } from '../../types';

type AudioSettingsModalProps = {
  showAudioSettings: boolean;
  setShowAudioSettings: (value: boolean) => void;
  audioInputDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  selectedMicrophone: string;
  selectedSpeaker: string;
  changeMicrophone: (deviceId: string) => Promise<void>;
  changeSpeaker: (deviceId: string) => Promise<void>;
  getAudioDevices: () => Promise<void>;
  sendRawAudio: boolean;
  toggleSendRawAudio: () => void;
  noiseFilterSettings: NoiseFilterSettings;
  updateNoiseFilterSettings: (settings: Partial<NoiseFilterSettings>) => void;
  toggleNoiseFilter: () => void;
  translationSpeedMode: TranslationSpeedMode;
  translationSpeedSettings: TranslationSpeedSettings;
  updateTranslationSpeedMode: (mode: TranslationSpeedMode) => void;
};

export const AudioSettingsModal: React.FC<AudioSettingsModalProps> = ({
  showAudioSettings,
  setShowAudioSettings,
  audioInputDevices,
  audioOutputDevices,
  selectedMicrophone,
  selectedSpeaker,
  changeMicrophone,
  changeSpeaker,
  getAudioDevices,
  sendRawAudio,
  toggleSendRawAudio,
  noiseFilterSettings,
  updateNoiseFilterSettings,
  toggleNoiseFilter,
  translationSpeedMode,
  translationSpeedSettings,
  updateTranslationSpeedMode
}) => {
  if (!showAudioSettings) {
    return null;
  }

  return (
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

            <div className="mt-2">
              <label className="flex items-center text-xs font-medium">
                <input
                  type="checkbox"
                  checked={!sendRawAudio}
                  onChange={() => toggleSendRawAudio()}
                  className="mr-2 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                />
                Send only translated audio (disable raw audio)
              </label>
            </div>

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
                  value={TranslationSpeedMode.ULTRAFAST}
                  checked={translationSpeedMode === TranslationSpeedMode.ULTRAFAST}
                  onChange={(e) => updateTranslationSpeedMode(e.target.value as TranslationSpeedMode)}
                  className="text-blue-600 bg-gray-700 border-gray-600"
                />
                <span>Ultra-fast (15x Cost)</span>
                <span className="text-gray-400 ml-auto">~0.3s delay</span>
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
                  value={TranslationSpeedMode.ECONOMY}
                  checked={translationSpeedMode === TranslationSpeedMode.ECONOMY}
                  onChange={(e) => updateTranslationSpeedMode(e.target.value as TranslationSpeedMode)}
                  className="text-blue-600 bg-gray-700 border-gray-600"
                />
                <span>Economy (Low Cost)</span>
                <span className="text-gray-400 ml-auto">~4s delay</span>
              </label>
            </div>
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
  );
};
