import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { MoochaProvider } from './store.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MoochaProvider>
      <App />
    </MoochaProvider>
  </React.StrictMode>
);
