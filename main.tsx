import React from 'react';
import { createRoot } from 'react-dom/client';
import { useConferenceApp } from './hooks';
import { ConferenceApp } from './components';
import { GenerativeArtBackground } from './generative-art-background';
import { GenerativeArtBackgroundWebGL } from './generative-art-background-webgl';

// Export components for demo pages
(window as any).React = React;
(window as any).ReactDOM = { createRoot };
(window as any).GenerativeArtBackground = GenerativeArtBackground;
(window as any).GenerativeArtBackgroundWebGL = GenerativeArtBackgroundWebGL;

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