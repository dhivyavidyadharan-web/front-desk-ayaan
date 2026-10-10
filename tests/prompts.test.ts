// Brief §4.1: the agent's prompt must not contain pricing, only the deflection line.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizePhone } from '@/core/phone';

const voice = readFileSync('prompts/voice_agent.md', 'utf8');
const extraction = readFileSync('prompts/extraction.md', 'utf8');
const DEFLECTION =
  'Pricing depends on the site, the materials you choose, and the scope. Your designer will walk you through it in detail at the consultation. I can book that for you right now if you\'d like.';

// Any amount tied to money: "₹4,00,000", "Rs 5", "8 lakh", "12L", "2000 per sq ft".
const AMOUNT = /₹\s?\d|\brs\.?\s?\d|\binr\s?\d|\d[\d,.]*\s?(?:lakhs?|lacs?|crores?|cr|l|k)\b|\d[\d,.]*\s?(?:per|\/)\s?(?:sq|square)/i;

describe('prompts', () => {
  it.each([
    ['voice agent', voice],
    ['extraction', extraction],
  ])('%s prompt contains no money amounts', (_, text) => {
    expect(text.match(AMOUNT)).toBeNull();
  });

  it('voice agent prompt carries the exact deflection line', () => {
    expect(voice).toContain(DEFLECTION);
  });

  it('voice agent never offers a free consultation', () => {
    expect(voice).toMatch(/Never say the consultation is free/);
    const withoutProhibitions = voice
      .split('\n')
      .filter((l) => !/\bnever\b/i.test(l))
      .join('\n');
    expect(withoutProhibitions).not.toMatch(/consultation is free|free consultation/i);
  });

  it('voice agent quotes no design or execution durations', () => {
    expect(voice).not.toMatch(/3[–-]4 weeks|8[–-]1[06] weeks/);
  });

  it('voice agent prompt has the template slots the session fills', () => {
    expect(voice).toContain('{{caller_name}}');
    expect(voice).toContain('{{returning_context}}');
  });
});

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['+14155550172', '+14155550172'],
  ])('%s → %s', (input, out) => {
    expect(normalizePhone(input)).toBe(out);
  });

  it.each(['12345', '5876543210', 'not a number', ''])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
