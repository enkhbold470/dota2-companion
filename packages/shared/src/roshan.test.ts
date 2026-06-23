import { describe, it, expect } from 'vitest';
import { roshanTimer } from './roshan';

describe('roshanTimer', () => {
  it('is unknown until a kill is recorded', () => {
    expect(roshanTimer({ killedAtClock: null }, 1000)).toEqual({
      status: 'unknown',
      minRespawn: null, maxRespawn: null, secondsToMin: null, secondsToMax: null,
    });
  });

  it('counts down the 8:00–11:00 window after a kill', () => {
    // killed at 10:00 (600s), now 12:00 (720s) → 120s elapsed
    expect(roshanTimer({ killedAtClock: 600 }, 720)).toEqual({
      status: 'dead',
      minRespawn: 1080,   // 600 + 480
      maxRespawn: 1260,   // 600 + 660
      secondsToMin: 360,
      secondsToMax: 540,
    });
  });

  it('reports negative remaining once the window has passed (may have respawned)', () => {
    const t = roshanTimer({ killedAtClock: 600 }, 1300);
    expect(t.secondsToMin).toBe(-220);
    expect(t.secondsToMax).toBe(-40);
  });
});
