import { describe, it, expect } from 'vitest';
import { resolveMode, readLastMatch, LAST_MATCH_KEY } from './studioMode';

describe('resolveMode', () => {
  it('is live during any in-game phase', () => {
    for (const phase of ['loading', 'hero_selection', 'strategy', 'pre_game', 'in_progress'] as const) {
      expect(resolveMode(phase, 'auto')).toBe('live');
    }
  });

  it('is studio after the game, on unknown phase, and before GSI connects', () => {
    expect(resolveMode('post_game', 'auto')).toBe('studio');
    expect(resolveMode('unknown', 'auto')).toBe('studio');
    expect(resolveMode(null, 'auto')).toBe('studio');
  });

  it('manual override wins', () => {
    expect(resolveMode('in_progress', 'studio')).toBe('studio');
    expect(resolveMode(null, 'live')).toBe('live');
  });
});

describe('readLastMatch', () => {
  const storageWith = (v: string | null): Pick<Storage, 'getItem'> => ({ getItem: () => v });

  it('parses a remembered match', () => {
    const raw = JSON.stringify({ matchId: '812', accountId: '52079950', seenAtMs: 5 });
    expect(readLastMatch(storageWith(raw))).toEqual({ matchId: '812', accountId: '52079950', seenAtMs: 5 });
  });

  it('rejects missing/garbage values', () => {
    expect(readLastMatch(storageWith(null))).toBeNull();
    expect(readLastMatch(storageWith('not json'))).toBeNull();
    expect(readLastMatch(storageWith(JSON.stringify({ matchId: 812 })))).toBeNull();
  });

  it('exports the storage key the App writes', () => {
    expect(LAST_MATCH_KEY).toBe('nf.lastMatch');
  });
});
