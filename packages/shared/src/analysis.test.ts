import { describe, it, expect } from 'vitest';
import { buildAnalysisContext, ANALYSIS_CONTEXT_MAX_CHARS, BUCKET_SEC } from './analysis';
import type { RecordedSession, StoredFocusPoint } from './session';

function point(t: number, focus: number, over: Partial<StoredFocusPoint> = {}): StoredFocusPoint {
  return { t, focus, stress: 40, state: 'FOCUSED', tilt: 0, quality: 3, ...over };
}

function session(over: Partial<RecordedSession> = {}): RecordedSession {
  return {
    format: 'neurofocus_ble_eeg_v2',
    startedAtMs: 1_000, endedAtMs: 61_000, durationSec: 60,
    matchId: '812',
    focus: [], events: [],
    ...over,
  };
}

describe('buildAnalysisContext', () => {
  it('buckets the 1 Hz timeline into 15 s aggregates', () => {
    const points = Array.from({ length: 30 }, (_, i) => point(i, i < 15 ? 60 : 30));
    const ctx = buildAnalysisContext(session({ focus: points }));
    expect(ctx.buckets).toHaveLength(2);
    expect(ctx.buckets[0]).toEqual({ t: 0, focusAvg: 60, focusMin: 60, stressAvg: 40, tiltMax: 0 });
    expect(ctx.buckets[1]?.focusAvg).toBe(30);
    expect(ctx.buckets[1]?.t).toBe(BUCKET_SEC);
  });

  it('computes aggregates, tilt share, and the heuristic crash', () => {
    // Focus 70 until a death at t=60, then 40 — a sustained crash findCrash sees.
    const points = Array.from({ length: 120 }, (_, i) =>
      point(i, i < 60 ? 70 : 40, i >= 60 && i < 80 ? { state: 'TILTED' } : {}));
    const ctx = buildAnalysisContext(session({
      focus: points,
      events: [{ t: 60, kind: 'death' }, { t: 20, kind: 'kill' }, { t: 90, kind: 'level_up', value: 12 }],
    }));
    expect(ctx.stats.deaths).toBe(1);
    expect(ctx.stats.kills).toBe(1);
    expect(ctx.stats.focusMin).toBe(40);
    expect(ctx.stats.tiltedPct).toBeCloseTo((20 / 120) * 100, 0);
    expect(ctx.stats.crash?.deathAt).toBe(60);
    expect(ctx.events).toContainEqual({ t: 90, kind: 'level_up', value: 12 });
  });

  it('stays under the serialized budget for a very long session', () => {
    const points = Array.from({ length: 4 * 3600 }, (_, i) => point(i, 50 + (i % 20)));
    const ctx = buildAnalysisContext(session({ focus: points, durationSec: 4 * 3600 }));
    expect(JSON.stringify(ctx).length).toBeLessThanOrEqual(ANALYSIS_CONTEXT_MAX_CHARS);
  });
});
