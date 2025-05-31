// Mock for log-utils
export function getTimestamp(): string {
  return '2025-01-01 00:00:00.000 JST';
}

export function logWithTimestamp(message: string, ...args: any[]): void {
  console.log(`[${getTimestamp()}] ${message}`, ...args);
}

export const log = logWithTimestamp;