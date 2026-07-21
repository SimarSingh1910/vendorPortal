import React from 'react';
import ReactDOM from 'react-dom/client';
// Brand fonts (self-hosted, offline-safe). Inter = HCL Healthcare's UI face
// (measured from hclhealthcare.in); JetBrains Mono for figures/codes/IDs.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import { App } from '@/App';
import '@/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
