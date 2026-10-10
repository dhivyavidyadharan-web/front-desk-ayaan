import { describe, expect, it } from 'vitest';
import { designerLinkCode, parseLinkCode, teamLinkCode } from '@/integrations/telegramLink';

const SECRET = 'link-secret';
const ID = '00000000-0000-0000-0000-0000000000d2';

describe('Telegram connect codes', () => {
  it('round-trips a designer code and fits Telegram’s 64-char start payload', () => {
    const code = designerLinkCode(ID, SECRET);
    expect(code.length).toBeLessThanOrEqual(64);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseLinkCode(code, SECRET)).toEqual({ kind: 'designer', designerId: ID });
  });

  it('round-trips the team code', () => {
    expect(parseLinkCode(teamLinkCode(SECRET), SECRET)).toEqual({ kind: 'team' });
  });

  it('rejects tampered or foreign codes', () => {
    const code = designerLinkCode(ID, SECRET);
    const otherDesigner = code.replace('d2_', 'd3_');
    expect(parseLinkCode(otherDesigner, SECRET)).toBeNull();
    expect(parseLinkCode(code, 'another-secret')).toBeNull();
    expect(parseLinkCode('team_aaaaaaaaaaaa', SECRET)).toBeNull();
    expect(parseLinkCode('hello', SECRET)).toBeNull();
  });
});
