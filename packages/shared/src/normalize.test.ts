import { describe, it, expect } from 'vitest';
import { normalizeGsi } from './normalize';
import type { GsiPayload } from './types';

const full: GsiPayload = {
  map: {
    matchid: '123', clock_time: 600, daytime: true, paused: false,
    game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
  },
  player: { gold: 1500, net_worth: 5200, gpm: 540, xpm: 610, last_hits: 88 },
  hero: { id: 26, level: 12, alive: true, respawn_seconds: 0, has_aghanims_shard: true },
  items: {
    slot0: { name: 'item_blink' },
    slot1: { name: 'empty' },
    slot2: { name: 'item_force_staff' },
    neutral0: { name: 'item_keen_optic' },
  },
};

describe('normalizeGsi', () => {
  it('maps map/player/hero fields', () => {
    const s = normalizeGsi(full);
    expect(s.matchId).toBe('123');
    expect(s.inProgress).toBe(true);
    expect(s.clock).toBe(600);
    expect(s.isDay).toBe(true);
    expect(s.hero.id).toBe(26);
    expect(s.hero.hasShard).toBe(true);
    expect(s.hero.hasScepter).toBe(false);
    expect(s.economy.gpm).toBe(540);
    expect(s.economy.netWorth).toBe(5200);
  });

  it('collects only non-empty item slots (ignores neutral/stash keys)', () => {
    const s = normalizeGsi(full);
    expect(s.items).toEqual(['item_blink', 'item_force_staff']);
  });

  it('returns nulls for an empty payload without throwing', () => {
    const s = normalizeGsi({});
    expect(s.matchId).toBeNull();
    expect(s.inProgress).toBe(false);
    expect(s.clock).toBeNull();
    expect(s.isDay).toBeNull();
    expect(s.hero.id).toBeNull();
    expect(s.economy.gpm).toBeNull();
    expect(s.items).toEqual([]);
  });
});
