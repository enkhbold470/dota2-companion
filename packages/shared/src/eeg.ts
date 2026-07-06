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

export type Band = 'delta' | 'theta' | 'alpha' | 'beta' | 'gamma';

/** Classic clinical band edges in Hz (match firmware/v4/bands.json). */
export const BAND_HZ: Record<Band, [number, number]> = {
  delta: [0.5, 4],
  theta: [4, 8],
  alpha: [8, 13],
  beta: [13, 30],
  gamma: [30, 45],
};

export type BandPowers = Record<Band, number>;

const ZERO_BANDS: BandPowers = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };

/**
 * Periodogram band powers over a window of raw samples.
 * Detrends (removes mean), applies a Hann window, then integrates the squared
 * DFT magnitude across the bins that fall in each band. O(N · bins) — cheap at
 * the ~1 Hz cadence we run it (N≈512, bins≈90).
 */
export function computeBandPowers(samples: readonly number[], sampleRateHz: number): BandPowers {
  const N = samples.length;
  if (N < 16 || sampleRateHz <= 0) return { ...ZERO_BANDS };

  let mean = 0;
  for (const s of samples) mean += s;
  mean /= N;

  // Hann-windowed, mean-removed signal.
  const w = new Array<number>(N);
  for (let n = 0; n < N; n++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1));
    w[n] = (samples[n]! - mean) * hann;
  }

  const df = sampleRateHz / N;                 // frequency resolution per bin
  const kMax = Math.min(Math.floor(N / 2), Math.ceil(BAND_HZ.gamma[1] / df));
  const kMin = Math.max(1, Math.floor(BAND_HZ.delta[0] / df));

  const out: BandPowers = { ...ZERO_BANDS };
  for (let k = kMin; k <= kMax; k++) {
    let re = 0;
    let im = 0;
    const c = (2 * Math.PI * k) / N;
    for (let n = 0; n < N; n++) {
      re += w[n]! * Math.cos(c * n);
      im -= w[n]! * Math.sin(c * n);
    }
    const power = re * re + im * im;
    const f = k * df;
    const band = bandOf(f);
    if (band) out[band] += power;
  }
  return out;
}

function bandOf(f: number): Band | null {
  for (const band of Object.keys(BAND_HZ) as Band[]) {
    const [lo, hi] = BAND_HZ[band];
    if (f >= lo && f < hi) return band;
  }
  return null;
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
  if (railedLow || railedHigh) return 2;
  return 3;
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
