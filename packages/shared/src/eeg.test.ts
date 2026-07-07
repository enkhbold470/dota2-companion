import { describe, it, expect } from 'vitest';
import {
  computeBandPowers, focusFeatures, contactQuality, RollingStat, FocusMonitor, findCrash,
  type FocusInput, type FocusReading,
} from './eeg';

const RATE = 250;
const N = 512;

/** A pure sine at `hz` sampled at RATE, offset to look like ADS1220 counts. */
function sine(hz: number, amp = 1000, n = N): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(4_000_000 + amp * Math.sin((2 * Math.PI * hz * i) / RATE));
  return out;
}

describe('computeBandPowers', () => {
  it('puts a 10 Hz tone in the alpha band', () => {
    const bp = computeBandPowers(sine(10), RATE);
    const bands = Object.entries(bp).sort((a, b) => b[1] - a[1]);
    expect(bands[0]![0]).toBe('alpha');
  });

  it('puts a 20 Hz tone in the beta band', () => {
    const bp = computeBandPowers(sine(20), RATE);
    const bands = Object.entries(bp).sort((a, b) => b[1] - a[1]);
    expect(bands[0]![0]).toBe('beta');
  });

  it('returns zeros for a too-short window', () => {
    expect(computeBandPowers([1, 2, 3], RATE)).toEqual({ delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 });
  });
});

describe('focusFeatures', () => {
  it('focus index rises when beta dominates alpha+theta', () => {
    const highBeta = focusFeatures({ delta: 1, theta: 1, alpha: 1, beta: 10, gamma: 1 });
    const lowBeta = focusFeatures({ delta: 1, theta: 5, alpha: 5, beta: 1, gamma: 1 });
    expect(highBeta.focus).toBeGreaterThan(lowBeta.focus);
  });
});

describe('contactQuality', () => {
  it('flags a flat (DC) window as unusable', () => {
    expect(contactQuality(new Array(N).fill(4_000_000))).toBe(0);
  });
  it('rates a clean mid-range oscillation as clean', () => {
    expect(contactQuality(sine(10, 5000))).toBe(3);
  });
  it('flags a railed-low window', () => {
    const s = sine(10, 5000).map((v) => v - 4_000_000); // centered near 0 → rails low
    expect(contactQuality(s)).toBeLessThanOrEqual(2);
  });

  it('stays usable when 60 Hz mains dominates (regression: froze focus at 50)', () => {
    // Real dry-electrode capture: µV-scale EEG buried under strong mains pickup.
    // The DSP notches mains out downstream, so this must NOT be gated to unusable.
    const win: number[] = [];
    for (let i = 0; i < N; i++) {
      const tt = i / RATE;
      const eeg = 15 * Math.sin(2 * Math.PI * 10 * tt);
      const mains = 80 * Math.sin(2 * Math.PI * 60 * tt); // 60 Hz >> EEG
      win.push(Math.round(4_000_000 + (eeg + mains) * 2.54));
    }
    expect(contactQuality(win)).toBeGreaterThanOrEqual(2);
  });
});

describe('RollingStat', () => {
  it('z-scores against its own window', () => {
    const rs = new RollingStat(100);
    for (let i = 0; i < 50; i++) rs.push(10);
    for (let i = 0; i < 50; i++) rs.push(20);
    expect(rs.mean).toBeCloseTo(15, 0);
    expect(rs.z(15)).toBeCloseTo(0, 1);
    expect(rs.z(20)).toBeGreaterThan(0);
  });
  it('returns 0 z before a stable baseline exists', () => {
    const rs = new RollingStat();
    rs.push(5);
    expect(rs.z(99)).toBe(0);
  });
});

function input(over: Partial<FocusInput> & { t: number }): FocusInput {
  return {
    features: { focus: 1, stressBeta: 0.2, relaxation: 0.2 },
    quality: 3, recentDeaths: 0, inFight: false, ...over,
  };
}

describe('FocusMonitor', () => {
  it('stays UNKNOWN on poor contact and never fabricates a state', () => {
    const m = new FocusMonitor();
    const r = m.push(input({ t: 0, quality: 1 }));
    expect(r.state).toBe('UNKNOWN');
    expect(r.focusScore).toBe(50);
  });

  it('reports CALIBRATING until baselined, then FOCUSED at the norm', () => {
    const m = new FocusMonitor();
    let r!: FocusReading;
    for (let t = 0; t < 25; t++) r = m.push(input({ t, features: { focus: 1, stressBeta: 0.2, relaxation: 0.2 } }));
    expect(r.state).toBe('FOCUSED');
    expect(r.focusScore).toBeGreaterThan(40);
    expect(r.focusScore).toBeLessThan(60);
  });

  it('enters FOCUS_DIP on a sustained drop below the session norm', () => {
    const m = new FocusMonitor();
    for (let t = 0; t < 30; t++) m.push(input({ t, features: { focus: 1, stressBeta: 0.2, relaxation: 0.2 } }));
    let r!: FocusReading;
    for (let t = 30; t < 35; t++) r = m.push(input({ t, features: { focus: 0.2, stressBeta: 0.2, relaxation: 0.2 } }));
    expect(r.state).toBe('FOCUS_DIP');
    expect(r.focusScore).toBeLessThan(40);
  });

  it('escalates to TILTED with sustained stress + multiple deaths out of fight', () => {
    const m = new FocusMonitor();
    for (let t = 0; t < 30; t++) m.push(input({ t, features: { focus: 1, stressBeta: 0.2, relaxation: 0.2 } }));
    let r!: FocusReading;
    for (let t = 30; t < 35; t++) {
      r = m.push(input({ t, features: { focus: 1, stressBeta: 0.6, relaxation: 0.1 }, recentDeaths: 2, inFight: false }));
    }
    expect(r.state).toBe('TILTED');
    expect(r.tilt).toBeGreaterThanOrEqual(2);
  });

  it('does not call it TILT mid-fight (high beta = engagement)', () => {
    const m = new FocusMonitor();
    for (let t = 0; t < 30; t++) m.push(input({ t, features: { focus: 1, stressBeta: 0.2, relaxation: 0.2 } }));
    let r!: FocusReading;
    for (let t = 30; t < 35; t++) {
      r = m.push(input({ t, features: { focus: 1, stressBeta: 0.6, relaxation: 0.1 }, recentDeaths: 2, inFight: true }));
    }
    expect(r.state).not.toBe('TILTED');
  });
});

describe('findCrash', () => {
  it('finds the death-linked focus drop', () => {
    const timeline: FocusReading[] = [];
    for (let t = 0; t < 120; t++) {
      const focusScore = t < 60 ? 75 : 45;   // crashed at 60
      timeline.push({ t, focusScore, stressScore: 50, focusZ: 0, stressZ: 0, quality: 3, state: 'FOCUSED', tilt: 0 });
    }
    const crash = findCrash(timeline, [{ t: 58, kind: 'death' }]);
    expect(crash).not.toBeNull();
    expect(crash!.from).toBeGreaterThan(crash!.to);
  });

  it('returns null when focus held steady', () => {
    const timeline: FocusReading[] = [];
    for (let t = 0; t < 120; t++) {
      timeline.push({ t, focusScore: 70, stressScore: 50, focusZ: 0, stressZ: 0, quality: 3, state: 'FOCUSED', tilt: 0 });
    }
    expect(findCrash(timeline, [{ t: 58, kind: 'death' }])).toBeNull();
  });
});
