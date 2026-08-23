import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from '@heroui/react';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider placement="top">
      <App />
    </ToastProvider>
  </StrictMode>,
);
