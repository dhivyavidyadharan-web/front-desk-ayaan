import { describe, expect, it } from 'vitest';
import { scanTextForPriceLeaks, scanTranscriptForPriceLeaks } from '@/core/priceLeak';

const DEFLECTION =
  "Pricing depends on the site, the materials you choose, and the scope. Your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.";

describe('flags price statements', () => {
  it.each([
    ['T10: repeating the caller’s budget', '1 to 1.5 lakh would be significantly below what a project of that scope would cost with us.'],
    ['T13: relative price hint', 'The difference between a standard and a premium kitchen alone can be 3× the cost.'],
    ['rupee amount', 'A kitchen is usually ₹4,00,000 or so.'],
    ['Rs amount', 'It would be Rs 5 lakh.'],
    ['amount then rupees', 'Around 8 lakh rupees for that.'],
    ['per sq ft', 'We charge 2000 per sq ft.'],
    ['per square foot', 'Somewhere near 1,800 per square foot.'],
    ['starts at', 'Our rates start at a reasonable level.'],
    ['starting from a number', 'Packages starting from 3.5 for a room.'],
    ['approximately Rs', 'It will be approximately Rs 10 lakh.'],
    ['cost around', 'For a 2BHK it would cost around what most studios charge.'],
    ['typically + cost', 'For a 2BHK it typically costs less than you think.'],
    ['thousand', 'Design fee is about 50 thousand.'],
    ['k shorthand', 'The kitchen is roughly 80k.'],
    ['crore', 'Villas can go up to a crore.'],
    ['Hindi lakh', 'Yeh lagbhag 5 लाख ka hoga.'],
    ['short lakh', 'About 12L for the whole flat.'],
  ])('%s', (_, text) => {
    expect(scanTextForPriceLeaks(text).length).toBeGreaterThan(0);
  });
});

describe('does not flag ordinary numbers', () => {
  it.each([
    ['the deflection line', DEFLECTION],
    ['T18: commercial size', 'Our commercial projects are typically 500 sq ft or more.'],
    ['T06: office size', 'We do commercial fitouts up to about 3,000 sq ft.'],
    ['T07: durations', 'A room redesign with execution takes at least 8–10 weeks from start to finish.'],
    ['T09: callback time', 'Someone senior will call you back within 15 minutes.'],
    ['a slot time', 'I have Saturday at 11am or Monday at 4pm.'],
    ['flat size', 'So that is a 2BHK of about 950 sq ft in Baner.'],
    ['consultation start', 'The consultation starts at 11 on Saturday.'],
  ])('%s', (_, text) => {
    expect(scanTextForPriceLeaks(text)).toEqual([]);
  });
});

describe('scanTranscriptForPriceLeaks', () => {
  it('ignores numbers said by the caller', () => {
    const hits = scanTranscriptForPriceLeaks([
      { speaker: 'caller', text: 'My budget is 1 to 1.5 lakh.' },
      { speaker: 'agent', text: DEFLECTION },
    ]);
    expect(hits).toEqual([]);
  });

  it('reports which agent turn leaked', () => {
    const hits = scanTranscriptForPriceLeaks([
      { speaker: 'caller', text: 'Roughly how much?' },
      { speaker: 'agent', text: 'Usually about ₹8 lakh.' },
    ]);
    expect(hits[0]?.turnIndex).toBe(1);
  });
});
