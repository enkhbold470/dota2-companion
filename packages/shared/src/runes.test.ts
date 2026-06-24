import { describe, it, expect } from 'vitest';
import { runeTimers, DEFAULT_RUNE_SCHEDULE } from './runes';

describe('runeTimers', () => {
  it('reports the next bounty, water and power spawns early game', () => {
    const t = runeTimers(100, DEFAULT_RUNE_SCHEDULE);
    const byType = Object.fromEntries(t.map((r) => [r.type, r]));
    expect(byType.bounty).toEqual({ type: 'bounty', nextSpawn: 180, secondsUntil: 80 });
    expect(byType.water).toEqual({ type: 'water', nextSpawn: 120, secondsUntil: 20 });
    expect(byType.power).toEqual({ type: 'power', nextSpawn: 360, secondsUntil: 260 });
  });

  it('drops water runes once both have spawned', () => {
    const t = runeTimers(300, DEFAULT_RUNE_SCHEDULE);
    expect(t.find((r) => r.type === 'water')).toBeUndefined();
  });

  it('rolls power runes forward on the 2-minute cadence', () => {
    const t = runeTimers(500, DEFAULT_RUNE_SCHEDULE);
    const power = t.find((r) => r.type === 'power');
    expect(power).toEqual({ type: 'power', nextSpawn: 600, secondsUntil: 100 });
  });

  it('handles pre-horn clock (bounty at 0:00)', () => {
    const t = runeTimers(-15, DEFAULT_RUNE_SCHEDULE);
    const bounty = t.find((r) => r.type === 'bounty');
    expect(bounty).toEqual({ type: 'bounty', nextSpawn: 0, secondsUntil: 15 });
  });

  it('finds the nearest water spawn even if the schedule array is unsorted', () => {
    const t = runeTimers(100, { ...DEFAULT_RUNE_SCHEDULE, water: [240, 120] });
    expect(t.find((r) => r.type === 'water')).toEqual({ type: 'water', nextSpawn: 120, secondsUntil: 20 });
  });
});
