import React from 'react';
import { Copy } from 'lucide-react';

type CopyModalProps = {
  showCopyModal: boolean;
};

export const CopyModal: React.FC<CopyModalProps> = ({ showCopyModal }) => {
  if (!showCopyModal) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 bg-opacity-95 backdrop-blur-sm p-4 rounded-lg border border-gray-700 text-center shadow-xl">
        <Copy className="w-6 h-6 text-green-500 mx-auto mb-3" />
        <h3 className="text-base font-semibold mb-2">Room URL Copied!</h3>
        <p className="text-gray-400 text-sm">Share this URL with others to join the conference</p>
      </div>
    </div>
  );
};
