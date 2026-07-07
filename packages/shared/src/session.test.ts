import { describe, it, expect } from 'vitest';
import {
  parseRecordedSession, parseSessionHead, sessionTimeMap,
  videoOffsetSec, clockAtVideoSec,
  type RecordedSession, type StoredFocusPoint,
} from './session';

const point = (t: number, tMs?: number): StoredFocusPoint =>
  ({ t, tMs, focus: 50, stress: 50, state: 'FOCUSED', tilt: 0, quality: 3 });

const base: RecordedSession = {
  format: 'neurofocus_ble_eeg_v2',
  startedAtMs: 1_000_000,
  endedAtMs: 1_010_000,
  durationSec: 10,
  focus: [],
  events: [],
};

describe('sessionTimeMap', () => {
  it('maps game clock to wall clock through v2 tMs anchors', () => {
    const map = sessionTimeMap({
      ...base,
      focus: [point(100, 1_000_000), point(101, 1_001_000), point(102, 1_002_000)],
    })!;
    expect(map.msAtClock(101)).toBe(1_001_000);
    // Between anchors: nearest anchor + linear delta.
    expect(map.msAtClock(101.5)).toBe(1_001_500);
    expect(map.clockAtMs(1_002_000)).toBe(102);
    expect(map.clockAtMs(1_000_400)).toBeCloseTo(100.4);
  });

  it('handles a game pause (clock stalls while wall clock advances)', () => {
    // Clock frozen at 200 for 3 s, then resumes.
    const map = sessionTimeMap({
      ...base,
      focus: [point(199, 0), point(200, 1000), point(200, 2000), point(200, 3000),
        point(200, 4000), point(201, 5000)],
    })!;
    // Seeking to the pause lands inside it, not before or long after.
    const ms = map.msAtClock(200);
    expect(ms).toBeGreaterThanOrEqual(1000);
    expect(ms).toBeLessThanOrEqual(4000);
    // The playhead during the pause reads clock ≈ 200.
    expect(map.clockAtMs(2500)).toBeCloseTo(200, 0);
  });

  it('synthesizes 1 Hz anchors for v1 sessions without tMs', () => {
    const map = sessionTimeMap({
      ...base,
      focus: [point(600), point(601), point(602)],
    })!;
    expect(map.msAtClock(601)).toBe(base.startedAtMs + 1000);
    expect(map.clockAtMs(base.startedAtMs + 2000)).toBe(602);
  });

  it('falls back to event anchors when there is no focus timeline', () => {
    const map = sessionTimeMap({
      ...base,
      events: [{ t: 50, tMs: 2_000_000, kind: 'kill' }],
    })!;
    expect(map.msAtClock(60)).toBe(2_010_000);
  });

  it('returns null with no usable anchors', () => {
    expect(sessionTimeMap(base)).toBeNull();
  });
});

describe('video offset helpers', () => {
  const video = { filename: 'a.webm', startedAtMs: 1_000_500 };
  const map = sessionTimeMap({
    ...base,
    focus: [point(100, 1_000_000), point(110, 1_010_000)],
  })!;

  it('converts a focus-dip clock time to a video seek offset', () => {
    expect(videoOffsetSec(map, video, 105)).toBeCloseTo(4.5);
  });

  it('clamps to zero when the moment predates the recording', () => {
    expect(videoOffsetSec(map, video, 100)).toBe(0);
  });

  it('inverts back from video time to game clock for the playhead', () => {
    const t = clockAtVideoSec(map, video, 4.5);
    expect(t).toBeCloseTo(105);
  });
});

describe('parseRecordedSession', () => {
  it('accepts a v2 session and normalizes video meta', () => {
    const s = parseRecordedSession({
      ...base,
      video: { filename: 'x.webm', startedAtMs: 5 },
    })!;
    expect(s.video).toEqual({ filename: 'x.webm', startedAtMs: 5 });
    expect(s.focus).toEqual([]);
  });

  it('rejects things that are not sessions', () => {
    expect(parseRecordedSession(null)).toBeNull();
    expect(parseRecordedSession([1, 2])).toBeNull();
    expect(parseRecordedSession({ format: 'other', startedAtMs: 1 })).toBeNull();
    expect(parseRecordedSession({ format: 'neurofocus_ble_eeg_v2' })).toBeNull();
  });

  it('drops malformed video meta instead of trusting it', () => {
    const s = parseRecordedSession({ ...base, video: { filename: 42 } })!;
    expect(s.video).toBeNull();
  });
});

describe('parseSessionHead', () => {
  const file = JSON.stringify({
    format: 'neurofocus_ble_eeg_v2',
    app: 'dota2-companion',
    startedAtMs: 1_700_000_000_000,
    endedAtMs: 1_700_000_600_000,
    durationSec: 600,
    source: 'device',
    device: 'NEUROFOCUS_V4',
    sampleRateHz: 598.4,
    truncated: false,
    matchId: '8461956309',
    video: { filename: 'neurofocus-dota-x.webm', startedAtMs: 1_700_000_000_100, mimeType: 'video/webm' },
    focus: [point(1, 1_700_000_000_000)],
    events: [],
    samples: Array.from({ length: 1000 }, (_, i) => i),
  });

  it('reads all listing metadata from just the first bytes', () => {
    const head = parseSessionHead(file.slice(0, 512));
    expect(head.format).toBe('neurofocus_ble_eeg_v2');
    expect(head.startedAtMs).toBe(1_700_000_000_000);   // top-level, not video's
    expect(head.durationSec).toBe(600);
    expect(head.matchId).toBe('8461956309');
    expect(head.video).toEqual({
      filename: 'neurofocus-dota-x.webm', startedAtMs: 1_700_000_000_100, mimeType: 'video/webm',
    });
  });

  it('handles v1 files with no video and a null matchId', () => {
    const v1 = JSON.stringify({
      format: 'neurofocus_ble_eeg_v1', startedAtMs: 5, endedAtMs: 10, durationSec: 5, matchId: null,
    });
    const head = parseSessionHead(v1);
    expect(head.video).toBeNull();
    expect(head.matchId).toBeNull();
    expect(head.startedAtMs).toBe(5);
  });
});
