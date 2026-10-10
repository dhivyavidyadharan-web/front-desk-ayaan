import { describe, expect, it } from 'vitest';
import { openingLine, timeGreeting } from '@/core/greeting';

const ist = (hhmm: string) => new Date(`2026-10-10T${hhmm}:00+05:30`);

describe('timeGreeting (Pune time)', () => {
  it.each([
    ['05:00', 'Good morning'],
    ['11:59', 'Good morning'],
    ['12:00', 'Good afternoon'],
    ['16:59', 'Good afternoon'],
    ['17:00', 'Good evening'],
    ['23:30', 'Good evening'],
    ['02:15', 'Hello'],
  ])('%s → %s', (t, g) => expect(timeGreeting(ist(t))).toBe(g));
});

describe('openingLine', () => {
  it('greets by time and name, introduces Ayaan, says the call is recorded, then asks how to help', () => {
    expect(openingLine('en', 'Rahul', false, ist('09:30'))).toBe(
      'Good morning, Rahul! This is Ayaan from Aangan Studio. This call is recorded to help us serve you better. How can I help you today?',
    );
  });

  it('works without a name and in Hindi/Marathi with masculine forms', () => {
    expect(openingLine('en', null, false, ist('18:00'))).toMatch(/^Good evening! This is Ayaan/);
    expect(openingLine('hi', 'Rahul', false, ist('14:00'))).toMatch(/^Good afternoon, Rahul! .*रिकॉर्ड.*कर सकता हूँ\?$/);
    expect(openingLine('mr', 'Rahul', false, ist('14:00'))).toMatch(/करू शकतो\?$/);
  });

  it('a caller whose line dropped is picked up where they left off', () => {
    expect(openingLine('en', 'Ritu', true, ist('14:20'))).toMatch(/cut off earlier.*recorded.*pick up where we left off/);
  });
});
