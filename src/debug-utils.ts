/**
 * Debug utility functions for conditional logging
 * Logs are only output when URL contains debug=true
 */

// Check if debug mode is enabled from URL query string
export const isDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return false; // SSR環境では無効
  }
  
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('debug') === 'true';
};

// Conditional console.log
export const debugLog = (...args: any[]): void => {
  if (isDebugEnabled()) {
    console.log(...args);
  }
};

// Conditional console.warn
export const debugWarn = (...args: any[]): void => {
  if (isDebugEnabled()) {
    console.warn(...args);
  }
};

// Conditional console.error (always show errors, but include debug info only in debug mode)
export const debugError = (...args: any[]): void => {
  if (isDebugEnabled()) {
    console.error(...args);
  } else {
    // Show only the first error message in production
    if (args.length > 0) {
      console.error(args[0]);
    }
  }
};

// Important logs that are always shown (session start/end, audio sending)
export const infoLog = (...args: any[]): void => {
  console.log(...args);
};

// Check debug status for external use
export const getDebugStatus = (): string => {
  return isDebugEnabled() ? 'Debug mode enabled (debug=true in URL)' : 'Debug mode disabled';
};