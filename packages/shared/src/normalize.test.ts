import { describe, it, expect } from 'vitest';
import { normalizeGsi, gamePhase } from './normalize';
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
    teleport0: { name: 'item_tpscroll' },
  },
  abilities: {
    ability0: { name: 'lion_impale', level: 4, can_cast: true, passive: false, ability_active: true, cooldown: 0, ultimate: false },
    ability1: { name: 'lion_voodoo', level: 2, can_cast: false, passive: false, ability_active: true, cooldown: 11, ultimate: false },
    ability2: { name: 'lion_finger_of_death', level: 1, can_cast: true, passive: false, ability_active: true, cooldown: 0, ultimate: true },
    ability3: { name: 'special_bonus_unique_lion_3', level: 1 },
    ability4: { name: 'plus_high_five', level: 1 },
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

  it('surfaces game_state, derived phase, and team', () => {
    const s = normalizeGsi({
      map: { game_state: 'DOTA_GAMERULES_STATE_STRATEGY_TIME' },
      player: { team_name: 'dire' },
    });
    expect(s.gameState).toBe('DOTA_GAMERULES_STATE_STRATEGY_TIME');
    expect(s.phase).toBe('strategy');
    expect(s.team).toBe('dire');
    // in_progress fixture:
    expect(normalizeGsi(full).phase).toBe('in_progress');
    expect(normalizeGsi(full).team).toBeNull(); // no team_name in `full`
  });

  it('gamePhase maps the DOTA_GAMERULES_STATE_* enum, unknown → unknown', () => {
    expect(gamePhase('DOTA_GAMERULES_STATE_HERO_SELECTION')).toBe('hero_selection');
    expect(gamePhase('DOTA_GAMERULES_STATE_STRATEGY_TIME')).toBe('strategy');
    expect(gamePhase('DOTA_GAMERULES_STATE_PRE_GAME')).toBe('pre_game');
    expect(gamePhase('DOTA_GAMERULES_STATE_GAME_IN_PROGRESS')).toBe('in_progress');
    expect(gamePhase('DOTA_GAMERULES_STATE_POST_GAME')).toBe('post_game');
    expect(gamePhase('DOTA_GAMERULES_STATE_WAIT_FOR_MAP_TO_LOAD')).toBe('loading');
    expect(gamePhase(undefined)).toBe('unknown');
    expect(gamePhase('something_else')).toBe('unknown');
  });

  it('collects only non-empty item slots (ignores neutral/stash keys)', () => {
    const s = normalizeGsi(full);
    expect(s.items).toEqual(['item_blink', 'item_force_staff']);
  });

  it('detects the TP scroll in the teleport slot', () => {
    expect(normalizeGsi(full).hasTp).toBe(true);
    expect(normalizeGsi({ items: { teleport0: { name: 'empty' } } }).hasTp).toBe(false);
    expect(normalizeGsi({}).hasTp).toBe(false);
  });

  it('collects real abilities in slot order, filtering talents and cosmetics', () => {
    const s = normalizeGsi(full);
    expect(s.abilities.map((a) => a.name)).toEqual([
      'lion_impale', 'lion_voodoo', 'lion_finger_of_death',
    ]);
    expect(s.abilities[0]).toEqual({
      name: 'lion_impale', level: 4, canCast: true, cooldown: 0, passive: false, ultimate: false,
    });
    expect(s.abilities[1]?.cooldown).toBe(11);
    expect(s.abilities[2]?.ultimate).toBe(true);
  });

  it('defaults ability level to 0 and canCast to null when missing', () => {
    const s = normalizeGsi({ abilities: { ability0: { name: 'lion_impale' } } });
    expect(s.abilities[0]).toEqual({
      name: 'lion_impale', level: 0, canCast: null, cooldown: null, passive: false, ultimate: false,
    });
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
    expect(s.abilities).toEqual([]);
  });
});
