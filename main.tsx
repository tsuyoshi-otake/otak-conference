import React from 'react';
import { createRoot } from 'react-dom/client';
import { useConferenceApp } from './hooks';
import { ConferenceApp } from './components';

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