import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import IntelligenceRoute from './IntelligenceRoute';
import './styles.css';

function Shell() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // Intelligence laddas först när den öppnas (egen koddel) – Vision-delen påverkas inte.
  if (hash.startsWith('#/intelligence')) return <IntelligenceRoute />;
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[sw] registrering misslyckades', e));
  });
}
