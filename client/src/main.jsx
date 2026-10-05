import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { getInitialTheme, applyTheme } from './theme.js';
import './styles.css';

// Apply the saved/OS theme before the first paint, so there's no flash
// of the wrong color scheme.
applyTheme(getInitialTheme());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
