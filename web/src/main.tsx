import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// ?tenant=slug switches which hauler the dashboard shows (multi-tenant preview).
const params = new URLSearchParams(window.location.search);
const tenant = params.get('tenant');
if (tenant) {
  try {
    localStorage.setItem('hc_tenant', tenant);
  } catch {
    // storage unavailable; the default tenant is used
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
