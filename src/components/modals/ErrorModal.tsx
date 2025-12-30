import React from 'react';

type ErrorModalProps = {
  showErrorModal: boolean;
  errorMessage: string;
  setShowErrorModal: (value: boolean) => void;
};

export const ErrorModal: React.FC<ErrorModalProps> = ({
  showErrorModal,
  errorMessage,
  setShowErrorModal
}) => {
  if (!showErrorModal) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 bg-opacity-95 backdrop-blur-sm border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center">
            <span className="text-white text-lg font-bold">!</span>
          </div>
          <h3 className="text-lg font-semibold text-white">Error</h3>
        </div>
        <p className="text-gray-300 mb-6 leading-relaxed">
          {errorMessage}
        </p>
        <button
          onClick={() => setShowErrorModal(false)}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-colors font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
};
