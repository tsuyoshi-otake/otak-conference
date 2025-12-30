import React from 'react';
import { Sparkles, Sun } from 'lucide-react';

type CameraSettingsModalProps = {
  showCameraSettings: boolean;
  setShowCameraSettings: (value: boolean) => void;
  isBackgroundBlur: boolean;
  setIsBackgroundBlur: (value: boolean) => void;
  isBeautyMode: boolean;
  setIsBeautyMode: (value: boolean) => void;
  brightness: number;
  setBrightness: (value: number) => void;
};

export const CameraSettingsModal: React.FC<CameraSettingsModalProps> = ({
  showCameraSettings,
  setShowCameraSettings,
  isBackgroundBlur,
  setIsBackgroundBlur,
  isBeautyMode,
  setIsBeautyMode,
  brightness,
  setBrightness
}) => {
  if (!showCameraSettings) {
    return null;
  }

  return (
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
  );
};
