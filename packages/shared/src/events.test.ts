import { describe, it, expect } from 'vitest';
import { deriveEvents } from './events';
import type { NormalizedState } from './types';

function state(over: Partial<NormalizedState> & { clock?: number } = {}): NormalizedState {
  const { clock, ...rest } = over;
  return {
    matchId: 'm1', inProgress: true, paused: false, clock: clock ?? 100, isDay: true,
    hero: { id: 1, level: 5, alive: true, respawnSeconds: 0, hpPercent: 100, mpPercent: 100, hasScepter: false, hasShard: false },
    economy: { gold: 0, netWorth: 0, gpm: 0, xpm: 0, lastHits: 0 },
    combat: { kills: 0, deaths: 0, assists: 0 },
    items: [], hasTp: false, abilities: [],
    ...rest,
  };
}

describe('deriveEvents', () => {
  it('returns nothing without a prior snapshot', () => {
    expect(deriveEvents(null, state())).toEqual([]);
  });

  it('marks a kill and a death tagged to the clock', () => {
    const prev = state();
    const next = state({ clock: 130, combat: { kills: 1, deaths: 1, assists: 0 } });
    const ev = deriveEvents(prev, next);
    expect(ev).toContainEqual({ t: 130, kind: 'kill' });
    expect(ev).toContainEqual({ t: 130, kind: 'death' });
  });

  it('marks a respawn only on dead -> alive', () => {
    const dead = state({ hero: { ...state().hero, alive: false } });
    const alive = state({ clock: 150 });
    expect(deriveEvents(dead, alive)).toContainEqual({ t: 150, kind: 'respawn' });
    expect(deriveEvents(state(), state()).some((e) => e.kind === 'respawn')).toBe(false);
  });

  it('marks a level up with the new level', () => {
    const ev = deriveEvents(state({ hero: { ...state().hero, level: 5 } }), state({ hero: { ...state().hero, level: 6 } }));
    expect(ev).toContainEqual({ t: 100, kind: 'level_up', value: 6 });
  });

  it('marks game_start and game_end on the in-progress transition', () => {
    expect(deriveEvents(state({ inProgress: false }), state({ inProgress: true }))).toContainEqual({ t: 100, kind: 'game_start' });
    expect(deriveEvents(state({ inProgress: true }), state({ inProgress: false }))).toContainEqual({ t: 100, kind: 'game_end' });
  });

  it('marks a battle on a sharp HP drop while alive, but not a gentle one', () => {
    const full = state({ hero: { ...state().hero, hpPercent: 90 } });
    const hit = state({ clock: 200, hero: { ...state().hero, hpPercent: 60 } });
    expect(deriveEvents(full, hit)).toContainEqual({ t: 200, kind: 'battle', value: 60 });
    const chip = state({ hero: { ...state().hero, hpPercent: 85 } });
    expect(deriveEvents(full, chip).some((e) => e.kind === 'battle')).toBe(false);
  });

  it('does not fire a battle from HP hitting 0 on death (not alive)', () => {
    const full = state({ hero: { ...state().hero, hpPercent: 90 } });
    const dead = state({ hero: { ...state().hero, hpPercent: 0, alive: false } });
    expect(deriveEvents(full, dead).some((e) => e.kind === 'battle')).toBe(false);
  });

  it('marks a day/night flip', () => {
    expect(deriveEvents(state({ isDay: true }), state({ isDay: false }))).toContainEqual({ t: 100, kind: 'night' });
  });
});
