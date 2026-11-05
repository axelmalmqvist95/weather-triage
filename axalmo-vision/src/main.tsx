import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Intelligence-vyn laddas först när den öppnas – Vision-delen påverkas inte.
const IntelligenceView = lazy(() => import('./intelligence/IntelligenceView.tsx'));

function Shell() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  if (hash.startsWith('#/intelligence')) {
    return (
      <Suspense fallback={<div className="intel-loading">Laddar Intelligence…</div>}>
        <IntelligenceView />
      </Suspense>
    );
  }
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
