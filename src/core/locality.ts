import type { RubricConfig } from './config';

export type AreaMatch = 'allow' | 'deny' | 'borderline' | 'unknown';

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Matches a free-text locality against the configured lists. The longest matching entry wins,
 * so "Hinjewadi Phase 3" (borderline) beats "Hinjewadi" (allow).
 */
export function matchServiceArea(locality: string | null, config: RubricConfig): AreaMatch {
  if (!locality) return 'unknown';
  const text = ` ${normalise(locality)} `;
  let best: { list: AreaMatch; length: number } = { list: 'unknown', length: 0 };
  const lists: [AreaMatch, string[]][] = [
    ['allow', config.serviceAreaAllow],
    ['deny', config.serviceAreaDeny],
    ['borderline', config.serviceAreaBorderline],
  ];
  for (const [list, entries] of lists) {
    for (const entry of entries) {
      const needle = normalise(entry);
      if (needle && text.includes(` ${needle} `) && needle.length > best.length) {
        best = { list, length: needle.length };
      }
    }
  }
  return best.list;
}
