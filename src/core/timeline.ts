import type { RubricConfig } from './config';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolves a named deadline ("Diwali") to weeks from the call, using the next matching
 * festival date on or after the call date. Returns null when it can't be resolved.
 */
export function weeksUntilNamedDeadline(
  name: string | null,
  callAt: Date,
  config: RubricConfig,
): number | null {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  const upcoming = Object.entries(config.festivalDates)
    .filter(([label]) => label.toLowerCase().startsWith(wanted))
    .map(([, iso]) => new Date(`${iso}T00:00:00+05:30`))
    .filter((d) => d.getTime() >= callAt.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  const next = upcoming[0];
  return next ? (next.getTime() - callAt.getTime()) / MS_PER_WEEK : null;
}
