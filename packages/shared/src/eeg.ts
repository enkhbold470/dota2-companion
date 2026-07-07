/**
 * EEG feature engine — pure, framework-free, unit-testable.
 *
 * Turns a window of single-channel ADS1220 raw counts (the NeuroFocus V4 BLE
 * stream, `neurofocus_ble_eeg_v1`) into band powers and a baseline-relative
 * focus / stress state, following NEUROFOCUS_BIOMETRIC_LAYER.md:
 *  - focus (engagement) index ≈ beta / (alpha + theta)
 *  - "stress β" is the beta band's share of total power
 *  - everything is scored against the player's OWN rolling session baseline
 *    (z-scores), never absolute — consumer EEG is a coarse, noisy proxy.
 *  - states are debounced (hysteresis) and gated on contact quality.
 *
 * No claim of millisecond mind-reading: indices are meant to update ~1 Hz over
 * multi-second windows. See the doc's "Reality banner".
 */

import { bandPowers as dspBandPowers, EEG_FS, type BandPowers } from './dsp';

/**
 * Band powers over a window of raw ADS1220 counts. Delegates to the DSP pipeline
 * (detrend → software mains notch → 1–45 Hz band-pass → Welch PSD → per-band
 * integration) so the frequency axis is honest at 175 SPS. `lineFreq` is the
 * mains frequency to notch (60 in NA, 50 elsewhere; 0 disables).
 */
export function computeBandPowers(
  samples: readonly number[], sampleRateHz: number = EEG_FS, lineFreq = 60,
): BandPowers {
  return dspBandPowers(samples, sampleRateHz, lineFreq);
}

export interface FocusFeatures {
  /** Engagement / attention index ≈ beta / (alpha + theta). Higher = more engaged. */
  focus: number;
  /** Stress proxy: beta's share of total power (the screenshot's "Stress β"), 0..1. */
  stressBeta: number;
  /** Relaxation: alpha's share of total power, 0..1. */
  relaxation: number;
}

const EPS = 1e-9;

export function focusFeatures(bp: BandPowers): FocusFeatures {
  const total = bp.delta + bp.theta + bp.alpha + bp.beta + bp.gamma + EPS;
  return {
    focus: bp.beta / (bp.alpha + bp.theta + EPS),
    stressBeta: bp.beta / total,
    relaxation: bp.alpha / total,
  };
}

/**
 * Contact-quality heuristic (0 unusable … 3 clean) from a raw window.
 * ADS1220 rails near 0 or its 2^23 full-scale when an electrode is off; a
 * flat/near-constant window is also unusable. This gates every metric.
 *
 * NOTE: we deliberately do NOT gate on mains (50/60 Hz) power here. A dry
 * single electrode indoors picks up mains far stronger than the µV-scale EEG
 * (measured mains/EEG ratios of 5–10× are normal), so gating on it pins quality
 * to "unusable" forever — the bug that froze focus at 50. The DSP already
 * software-notches mains out before band powers, so mains presence is not a
 * contact fault. `mainsRatio` remains available for diagnostics.
 */
export function contactQuality(samples: readonly number[]): 0 | 1 | 2 | 3 {
  const N = samples.length;
  if (N < 16) return 0;
  let min = Infinity;
  let max = -Infinity;
  let mean = 0;
  for (const s of samples) { mean += s; if (s < min) min = s; if (s > max) max = s; }
  mean /= N;
  let variance = 0;
  for (const s of samples) variance += (s - mean) * (s - mean);
  variance /= N;
  const std = Math.sqrt(variance);

  const FULL_SCALE = 1 << 23;                  // 8_388_608
  const railedLow = min <= 1000;
  const railedHigh = max >= FULL_SCALE - 1000;
  // Real single-channel EEG rides as only tens–hundreds of counts on the ADS1220's
  // ~mid-scale DC bias (LSB ≈ 393 nV, ~8 µV noise floor ≈ 20 counts), so the "flat"
  // gate must sit near the noise floor — a higher bar falsely rejects a working but
  // low-amplitude signal as "no signal". Only an essentially-DC window is unusable.
  const flat = std < 12;                        // ≈ 5 µV — essentially DC, no biosignal
  const clipping = railedLow && railedHigh;     // swinging rail-to-rail = EMG/motion

  if (flat) return 0;
  if (clipping) return 1;
  return (railedLow || railedHigh) ? 2 : 3;
}

/** Rolling mean/SD over a bounded window — the per-session baseline. */
export class RollingStat {
  private buf: number[] = [];
  constructor(private readonly capacity = 300) {}     // 300 s at 1 Hz

  push(v: number): void {
    if (!Number.isFinite(v)) return;
    this.buf.push(v);
    if (this.buf.length > this.capacity) this.buf.shift();
  }
  get count(): number { return this.buf.length; }
  get mean(): number {
    if (this.buf.length === 0) return 0;
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }
  get std(): number {
    const n = this.buf.length;
    if (n < 2) return 0;
    const m = this.mean;
    return Math.sqrt(this.buf.reduce((a, b) => a + (b - m) * (b - m), 0) / n);
  }
  /** z-score of v vs the current window (0 until we have a stable baseline). */
  z(v: number): number {
    const s = this.std;
    if (s < EPS || this.buf.length < 8) return 0;
    return (v - this.mean) / s;
  }
}

export type MentalState =
  | 'UNKNOWN'       // no/poor signal, or not yet baselined
  | 'CALIBRATING'   // clean contact, building baseline
  | 'FOCUSED'
  | 'FOCUS_DIP'
  | 'STRESSED'
  | 'TILTED';

export interface FocusReading {
  t: number;                 // seconds on the session clock
  focusScore: number;        // 0..100, baseline-relative (50 = your session norm)
  stressScore: number;       // 0..100, baseline-relative
  focusZ: number;
  stressZ: number;
  quality: 0 | 1 | 2 | 3;
  state: MentalState;
  tilt: number;              // 0..5
}

export interface FocusInput {
  t: number;
  features: FocusFeatures;
  quality: 0 | 1 | 2 | 3;
  recentDeaths: number;      // GSI: deaths in the last ~60 s
  inFight: boolean;          // GSI: engaged right now (suppress tilt claims mid-fight)
}

const CALIBRATION_SAMPLES = 20;   // ~20 s of clean contact before z-scores are trusted

/**
 * Stateful, per-session focus monitor. Feed it ~1 Hz {features, quality, GSI
 * context}; it maintains the baseline and emits a debounced state + 0..100
 * scores. Pure aside from its own accumulated baseline — fully unit-testable.
 */
export class FocusMonitor {
  private focusBase = new RollingStat();
  private stressBase = new RollingStat();
  private dipRun = 0;
  private stressRun = 0;
  private state: MentalState = 'UNKNOWN';

  push(input: FocusInput): FocusReading {
    const { focus, stressBeta } = input.features;

    if (input.quality <= 1) {
      // Fail quiet — never fabricate a state from bad signal.
      this.dipRun = 0;
      this.stressRun = 0;
      this.state = 'UNKNOWN';
      return this.reading(input.t, 50, 50, 0, 0, input.quality);
    }

    this.focusBase.push(focus);
    this.stressBase.push(stressBeta);

    const baselined = this.focusBase.count >= CALIBRATION_SAMPLES;
    const focusZ = this.focusBase.z(focus);
    const stressZ = this.stressBase.z(stressBeta);
    const focusScore = clamp(Math.round(50 + 20 * focusZ), 0, 100);
    const stressScore = clamp(Math.round(50 + 20 * stressZ), 0, 100);

    if (!baselined) {
      this.state = 'CALIBRATING';
      return this.reading(input.t, focusScore, stressScore, focusZ, stressZ, input.quality);
    }

    // Debounced classification (hysteresis: enter on a short run, not one sample).
    this.dipRun = focusZ < -1 ? this.dipRun + 1 : 0;
    this.stressRun = stressZ > 1 ? this.stressRun + 1 : 0;

    let next: MentalState = 'FOCUSED';
    // Tilt: sustained stress across multiple recent deaths, and not mid-fight
    // (high beta in a fight is engagement, not tilt).
    if (this.stressRun >= 3 && input.recentDeaths >= 2 && !input.inFight) {
      next = 'TILTED';
    } else if (this.stressRun >= 3 && input.recentDeaths >= 1) {
      next = 'STRESSED';
    } else if (this.dipRun >= 3) {
      next = 'FOCUS_DIP';
    }
    this.state = next;

    const tilt = clamp(Math.round(Math.max(0, stressZ) + input.recentDeaths * 0.5), 0, 5);
    return this.reading(input.t, focusScore, stressScore, focusZ, stressZ, input.quality, tilt);
  }

  private reading(
    t: number, focusScore: number, stressScore: number,
    focusZ: number, stressZ: number, quality: 0 | 1 | 2 | 3, tilt = 0,
  ): FocusReading {
    return { t, focusScore, stressScore, focusZ, stressZ, quality, state: this.state, tilt };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export type GameEventKind =
  | 'game_start' | 'game_end'
  | 'kill' | 'death' | 'assist'
  | 'respawn' | 'level_up'
  | 'battle' | 'day' | 'night';

export interface MatchEvent {
  t: number;          // seconds on the match clock
  kind: GameEventKind;
  value?: number;     // context: new level for level_up, hp% at a battle hit, etc.
}

/**
 * Post-game "why did I crash?" — find the biggest sustained focus drop that
 * follows a death, for the mental-game report. Descriptive, never causal.
 */
export function findCrash(
  timeline: readonly FocusReading[],
  events: readonly MatchEvent[],
): { at: number; from: number; to: number; deathAt: number } | null {
  if (timeline.length < 4) return null;
  const deaths = events.filter((e) => e.kind === 'death');
  let worst: { at: number; from: number; to: number; deathAt: number } | null = null;

  for (const death of deaths) {
    const before = nearest(timeline, death.t - 15);
    const after = nearest(timeline, death.t + 45);
    if (!before || !after) continue;
    const drop = before.focusScore - after.focusScore;
    if (drop > 12 && (!worst || drop > worst.from - worst.to)) {
      worst = { at: after.t, from: before.focusScore, to: after.focusScore, deathAt: death.t };
    }
  }
  return worst;
}

function nearest(timeline: readonly FocusReading[], t: number): FocusReading | null {
  let best: FocusReading | null = null;
  let bestD = Infinity;
  for (const r of timeline) {
    const d = Math.abs(r.t - t);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

/**
 * The device-agnostic sample shape from NEUROFOCUS_BIOMETRIC_LAYER.md §2.1 — an
 * EEGSource emits these. `source:'derived'` marks a computed index (single ear
 * channel, coarse proxy), never a vendor's native metric. Scalars are 0..1.
 */
export interface MetricSample {
  t: number;
  focus?: number;
  stress?: number;
  engagement?: number;
  relaxation?: number;
  source: 'native' | 'derived';
  quality: 0 | 1 | 2 | 3;
}

/**
 * Turn a raw-counts window into a derived MetricSample: preprocess+Welch band
 * powers → focus/stress/engagement, gated on contact quality. Normalizes the
 * unbounded focus ratio to 0..1 with a soft squash so it's comparable to native
 * 0..1 metrics. Emits quality but no state — the FocusMonitor owns hysteresis.
 */
export function deriveMetric(
  samples: readonly number[], t: number, fs: number = EEG_FS, lineFreq = 60,
): MetricSample {
  const quality = contactQuality(samples);
  if (quality <= 1) return { t, source: 'derived', quality };
  const f = focusFeatures(computeBandPowers(samples, fs, lineFreq));
  // focus ratio beta/(alpha+theta) is ~0..several; squash to 0..1.
  const focus = f.focus / (1 + f.focus);
  return {
    t, source: 'derived', quality,
    focus, engagement: focus, stress: f.stressBeta, relaxation: f.relaxation,
  };
}
