'use client';
import { useEffect, useState } from 'react';
import { DESIGN_FACTS } from '@/crm/designFacts';

/** A pendant lamp and a rotating design fact, shown while a page loads. */
export function LoadingFact() {
  const [i, setI] = useState<number | null>(null);

  useEffect(() => {
    // Pick on the client so server and browser render the same placeholder first.
    setI(Math.floor(Math.random() * DESIGN_FACTS.length));
    const t = setInterval(() => setI((n) => ((n ?? 0) + 1) % DESIGN_FACTS.length), 4500);
    return () => clearInterval(t);
  }, []);

  const fact = i === null ? null : DESIGN_FACTS[i];
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
