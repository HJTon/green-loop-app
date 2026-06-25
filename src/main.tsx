import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the service worker (required for Add-to-Home-Screen to be offered)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// Capture the beforeinstallprompt event so the Settings page can trigger it later.
// Chrome/Edge only — iOS Safari requires a manual Add-to-Home-Screen action.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as unknown as { deferredInstallPrompt?: Event }).deferredInstallPrompt = e;
  // Notify any listener (e.g. SettingsPage mounted at that moment)
  window.dispatchEvent(new CustomEvent('installprompt-available'));
});

window.addEventListener('appinstalled', () => {
  (window as unknown as { deferredInstallPrompt?: Event }).deferredInstallPrompt = undefined;
  window.dispatchEvent(new CustomEvent('installprompt-consumed'));
});
