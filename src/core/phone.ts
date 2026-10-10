/** Normalises an Indian or international number to E.164, or returns null if it isn't one. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  let e164: string;
  if (trimmed.startsWith('+')) e164 = `+${digits}`;
  else if (digits.length === 10 && /^[6-9]/.test(digits)) e164 = `+91${digits}`;
  else if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) e164 = `+91${digits.slice(1)}`;
  else if (digits.length === 12 && digits.startsWith('91')) e164 = `+${digits}`;
  else return null;
  return /^\+[1-9][0-9]{6,14}$/.test(e164) ? e164 : null;
}
