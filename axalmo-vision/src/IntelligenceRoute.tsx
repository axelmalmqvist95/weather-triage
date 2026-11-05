import { Suspense, lazy, useMemo, useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { describeLoadError, importWithRetry } from './lazyRetry';

const loadIntelligence = () => importWithRetry(() => import('./intelligence/IntelligenceView.tsx'));

/**
 * Intelligence laddas vid behov. Misslyckas laddningen (t.ex. ny version publicerad eller inget nät)
 * visas ett begripligt fel med "Försök igen" och "Till Vision".
 */
export default function IntelligenceRoute() {
  const [attempt, setAttempt] = useState(0);
  // Ny lazy-komponent per försök – React.lazy cachar annars det misslyckade resultatet.
  const View = useMemo(() => lazy(loadIntelligence), [attempt]);

  return (
    <ErrorBoundary
      key={attempt}
      fallback={(error) => {
        const d = describeLoadError(error);
        return (
          <div className="load-error" role="alert">
            <h2>{d.title}</h2>
            <p>{d.detail}</p>
            <div className="load-error-actions">
              <button
                className="btn primary"
                onClick={() => (d.retry === 'reload' ? window.location.reload() : setAttempt((n) => n + 1))}
              >
                Försök igen
              </button>
              <a className="btn" href="#/">Till Vision</a>
            </div>
          </div>
        );
      }}
    >
      <Suspense fallback={<div className="intel-loading">Laddar Intelligence…</div>}>
        <View />
      </Suspense>
    </ErrorBoundary>
  );
}
