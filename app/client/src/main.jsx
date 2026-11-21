import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ToastProvider } from './components/ui.jsx';
import './index.css';

{
  const u = new URL(window.location.href);
  const t = u.searchParams.get('token');
  if (t) { localStorage.setItem('brim.token', t); u.searchParams.delete('token'); window.history.replaceState(null, '', u.toString()); }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
