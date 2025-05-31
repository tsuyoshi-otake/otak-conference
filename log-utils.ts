// Helper function to get timestamp with milliseconds in JST
export function getTimestamp(): string {
  const now = new Date();
  const jstOffset = 9 * 60; // JST is UTC+9
  const jstTime = new Date(now.getTime() + (jstOffset - now.getTimezoneOffset()) * 60000);
  
  const year = jstTime.getFullYear();
  const month = String(jstTime.getMonth() + 1).padStart(2, '0');
  const day = String(jstTime.getDate()).padStart(2, '0');
  const hours = String(jstTime.getHours()).padStart(2, '0');
  const minutes = String(jstTime.getMinutes()).padStart(2, '0');
  const seconds = String(jstTime.getSeconds()).padStart(2, '0');
  const milliseconds = String(jstTime.getMilliseconds()).padStart(3, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds} JST`;
}

// Custom console log with timestamp
export function logWithTimestamp(message: string, ...args: any[]): void {
  console.log(`[${getTimestamp()}] ${message}`, ...args);
}

// Export a shorter alias for convenience
export const log = logWithTimestamp;