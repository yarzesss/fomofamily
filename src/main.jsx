import React from 'react';
import { createRoot } from 'react-dom/client';
import { Buffer } from 'buffer';
import App from './App.jsx';
import './styles.css';
import '@solana/wallet-adapter-react-ui/styles.css';

window.Buffer = window.Buffer || Buffer;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
