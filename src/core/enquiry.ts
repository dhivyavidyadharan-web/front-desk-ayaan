/**
 * A call from the same number within the dedupe window of the previous call ending joins that
 * enquiry instead of starting a new one (dropped call + callback, T17).
 */
export function shouldJoinPreviousEnquiry(
  previousCallEndedAt: Date | null,
  newCallStartedAt: Date,
  windowMinutes: number,
): boolean {
  if (!previousCallEndedAt) return false;
  const gapMs = newCallStartedAt.getTime() - previousCallEndedAt.getTime();
  return gapMs >= 0 && gapMs <= windowMinutes * 60_000;
}
