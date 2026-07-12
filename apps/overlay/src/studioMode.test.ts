import { describe, it, expect } from 'vitest';
import { resolveMode } from './studioMode';

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
