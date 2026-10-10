'use client';
import { useEffect, useState } from 'react';
import { DESIGN_FACTS } from '@/crm/designFacts';

/** A pendant lamp and a rotating design fact, shown while a page loads. */
export function LoadingFact({ initial }: { initial: number }) {
  // The server picks the first fact, so it shows before the page's script loads.
  const [i, setI] = useState(initial);

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % DESIGN_FACTS.length), 4500);
    return () => clearInterval(t);
  }, []);

  const fact = DESIGN_FACTS[i % DESIGN_FACTS.length];
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="pendant" aria-hidden="true">
        <span className="cord" />
        <span className="shade" />
        <span className="bulb" />
        <span className="pool" />
      </div>
      <p className="loading-kind">{fact?.kind ?? 'Loading'}</p>
      <p className="loading-text">{fact?.text ?? ' '}</p>
    </div>
  );
}
