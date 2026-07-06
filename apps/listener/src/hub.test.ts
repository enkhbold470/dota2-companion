import { describe, it, expect, vi } from 'vitest';
import { Hub } from './hub';
import type { NormalizedState } from '@dc/shared';

const state = (matchId: string): NormalizedState => ({
  matchId, inProgress: true, paused: false, clock: 100, isDay: true,
  hero: { id: 1, level: 1, alive: true, respawnSeconds: 0, hpPercent: 100, mpPercent: 100, hasScepter: false, hasShard: false },
  economy: { gold: 0, netWorth: 0, gpm: 0, xpm: 0, lastHits: 0 },
  combat: { kills: 0, deaths: 0, assists: 0 },
  items: [],
  hasTp: false,
  abilities: [],
});

describe('Hub', () => {
  it('stores the latest state', () => {
    const hub = new Hub();
    expect(hub.getLatest()).toBeNull();
    hub.update(state('a'));
    expect(hub.getLatest()?.matchId).toBe('a');
  });

  it('notifies subscribers on update', () => {
    const hub = new Hub();
    const cb = vi.fn();
    hub.subscribe(cb);
    hub.update(state('b'));
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ matchId: 'b' }));
  });

  it('stops notifying after unsubscribe', () => {
    const hub = new Hub();
    const cb = vi.fn();
    const off = hub.subscribe(cb);
    off();
    hub.update(state('c'));
    expect(cb).not.toHaveBeenCalled();
  });
});
