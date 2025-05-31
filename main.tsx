import React from 'react';
import { createRoot } from 'react-dom/client';
import { useConferenceApp } from './hooks';
import { ConferenceApp } from './components';
import { GenerativeArtBackgroundWebGL } from './generative-art-background-webgl';

// Export components for demo pages
(window as any).React = React;
(window as any).ReactDOM = { createRoot };
(window as any).GenerativeArtBackgroundWebGL = GenerativeArtBackgroundWebGL;

// Display deployment information
const commitId = process.env.GIT_COMMIT_ID || 'unknown';
const workerDomain = process.env.CLOUDFLARE_WORKER_DOMAIN || 'otak-conference-worker.systemexe-research-and-development.workers.dev';

console.log('=== otak-conference Deployment Info ===');
console.log(`Git Commit ID: ${commitId}`);
console.log(`Worker Domain: ${workerDomain}`);
console.log(`Build Time: ${new Date().toISOString()}`);
console.log('=====================================');

const App = () => {
  const conferenceProps = useConferenceApp();
  
  return <ConferenceApp {...conferenceProps} />;
};

// Mount the React application to the DOM
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}

export default App;