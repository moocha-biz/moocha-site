import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { MoochaProvider } from './store.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <MoochaProvider>
          <App />
        </MoochaProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
