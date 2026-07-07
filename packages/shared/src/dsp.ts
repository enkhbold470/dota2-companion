/**
 * EEG DSP — pure, framework-free, unit-testable. No DOM, no I/O.
 *
 * Single-channel ADS1220 raw counts (NeuroFocus V4) → band powers, on a rolling
 * window. Every frequency computation depends on the sample rate, so the ONE
 * load-bearing constant here is EEG_FS.
 *
 * ★ SAMPLE RATE = 175 SPS, not 600. The ADS1220 runs at DR_LVL_3 (verified in
 *   ../../../neurofocus/firmware/v4/src/ads1220_driver.cpp:302), even though the
 *   firmware docs/config mention 600. If you assume 600, a 10 Hz alpha rhythm
 *   lands at ~27 Hz and every band is wrong. When the firmware is flipped to a
 *   real 600 SPS, change this single number.
 */

export const EEG_FS = 175;

/**
 * counts → microvolts (referred to the electrode). From the firmware:
 *   LSB = VREF / (PGA · 2^23);  µV = counts · LSB · 1e6 / AFE_GAIN
 * (signal_diagnostics.cpp). AFE_GAIN is the analog front-end gain; config.h ships
 * it as 1.0 (RTI at the ADC input), so µV thresholds are conservative. Band-power
 * RATIOS are scale-invariant, so the focus index doesn't use this at all — only
 * absolute contact-quality thresholds do.
 */
export interface CountScale { vref: number; pgaGain: number; afeGain: number }
export const DEFAULT_SCALE: CountScale = { vref: 3.3, pgaGain: 1, afeGain: 1 };

export function countsToMicrovolts(counts: number, scale: CountScale = DEFAULT_SCALE): number {
  const lsb = scale.vref / (scale.pgaGain * (1 << 23)); // volts per count
  return (counts * lsb * 1e6) / scale.afeGain;
}

export type Band = 'delta' | 'theta' | 'alpha' | 'beta' | 'gamma';

/** Band edges in Hz (NEUROFOCUS_BIOMETRIC_LAYER.md §2.3). */
export const BAND_HZ: Record<Band, [number, number]> = {
  delta: [1, 4],
  theta: [4, 8],
  alpha: [8, 12],
  beta: [13, 30],
  gamma: [30, 45],
};

const BANDS = Object.keys(BAND_HZ) as Band[];

/** Remove the least-squares linear trend (kills DC bias + slow drift). */
export function detrend(x: readonly number[]): number[] {
  const n = x.length;
  if (n < 2) return x.slice();
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += x[i]!; sxx += i * i; sxy += i * x[i]!;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = x[i]! - (slope * i + intercept);
  return out;
}

/** Direct-form-I biquad coefficients (normalized so a0 = 1). */
interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

// RBJ cookbook biquads. Q ~ 0.707 (Butterworth) unless noted.
function lowpass(fc: number, fs: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * fc) / fs, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
  const a0 = 1 + al;
  return {
    b0: ((1 - cw) / 2) / a0, b1: (1 - cw) / a0, b2: ((1 - cw) / 2) / a0,
    a1: (-2 * cw) / a0, a2: (1 - al) / a0,
  };
}
function highpass(fc: number, fs: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * fc) / fs, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
  const a0 = 1 + al;
  return {
    b0: ((1 + cw) / 2) / a0, b1: (-(1 + cw)) / a0, b2: ((1 + cw) / 2) / a0,
    a1: (-2 * cw) / a0, a2: (1 - al) / a0,
  };
}
function notch(f0: number, fs: number, q = 30): Biquad {
  const w = (2 * Math.PI * f0) / fs, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
  const a0 = 1 + al;
  return { b0: 1 / a0, b1: (-2 * cw) / a0, b2: 1 / a0, a1: (-2 * cw) / a0, a2: (1 - al) / a0 };
}

function runBiquad(x: readonly number[], f: Biquad): number[] {
  const y = new Array<number>(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** Zero-phase filter (forward + reverse), so band powers aren't phase-skewed. */
function filtfilt(x: readonly number[], f: Biquad): number[] {
  const fwd = runBiquad(x, f);
  const rev = runBiquad(fwd.slice().reverse(), f);
  return rev.reverse();
}

/**
 * Detrend, notch out mains (the ADS1220's on-chip 50/60 filter does nothing at
 * 175 SPS, so it must be done in software), then band-pass to ~1–45 Hz. Returns
 * a clean, zero-mean window ready for the periodogram.
 */
export function preprocess(samples: readonly number[], fs = EEG_FS, lineFreq = 60): number[] {
  let x = detrend(samples);
  if (lineFreq > 0 && lineFreq < fs / 2) x = filtfilt(x, notch(lineFreq, fs));
  x = filtfilt(x, highpass(BAND_HZ.delta[0], fs));
  const top = Math.min(BAND_HZ.gamma[1], fs / 2 - 1);
  x = filtfilt(x, lowpass(top, fs));
  return x;
}

export interface Psd { freqs: number[]; psd: number[] }

/**
 * Welch PSD: split into Hann-windowed segments (default ~1 s, 50% overlap),
 * periodogram each, average. One-sided, up to Nyquist. Direct DFT (O(nperseg²)
 * per segment) — fine at the ~2 Hz update cadence with nperseg≈175.
 */
export function welchPsd(x: readonly number[], fs = EEG_FS, nperseg = Math.round(fs), overlap = 0.5): Psd {
  const N = x.length;
  const seg = Math.min(nperseg, N);
  if (seg < 8) return { freqs: [], psd: [] };
  const step = Math.max(1, Math.round(seg * (1 - overlap)));
  const half = Math.floor(seg / 2);

  // Hann window + its power (for normalization).
  const win = new Array<number>(seg);
  let winPow = 0;
  for (let i = 0; i < seg; i++) { const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (seg - 1)); win[i] = h; winPow += h * h; }

  const acc = new Array<number>(half + 1).fill(0);
  let segments = 0;
  for (let start = 0; start + seg <= N; start += step) {
    let mean = 0;
    for (let i = 0; i < seg; i++) mean += x[start + i]!;
    mean /= seg;
    const wseg = new Array<number>(seg);
    for (let i = 0; i < seg; i++) wseg[i] = (x[start + i]! - mean) * win[i]!;
    for (let k = 0; k <= half; k++) {
      let re = 0, im = 0;
      const c = (2 * Math.PI * k) / seg;
      for (let n = 0; n < seg; n++) { re += wseg[n]! * Math.cos(c * n); im -= wseg[n]! * Math.sin(c * n); }
      let p = (re * re + im * im) / (fs * winPow);
      if (k > 0 && k < half) p *= 2; // one-sided (fold negative freqs)
      acc[k]! += p;
    }
    segments++;
  }
  if (segments === 0) return { freqs: [], psd: [] };
  const freqs = new Array<number>(half + 1);
  const psd = new Array<number>(half + 1);
  for (let k = 0; k <= half; k++) { freqs[k] = (k * fs) / seg; psd[k] = acc[k]! / segments; }
  return { freqs, psd };
}

export type BandPowers = Record<Band, number>;
const ZERO_BANDS: BandPowers = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };

/** Integrate a PSD across each band's frequency range (trapezoid). */
export function bandPowersFromPsd({ freqs, psd }: Psd): BandPowers {
  const out: BandPowers = { ...ZERO_BANDS };
  if (freqs.length < 2) return out;
  for (let k = 1; k < freqs.length; k++) {
    const f0 = freqs[k - 1]!, f1 = freqs[k]!;
    const fc = (f0 + f1) / 2;
    const area = ((psd[k - 1]! + psd[k]!) / 2) * (f1 - f0);
    for (const b of BANDS) { const [lo, hi] = BAND_HZ[b]; if (fc >= lo && fc < hi) { out[b] += area; break; } }
  }
  return out;
}

/**
 * Full pipeline: preprocess → Welch → band powers. This is what the focus engine
 * calls. `lineFreq` 50 or 60 depending on region; 0 disables the notch.
 */
export function bandPowers(samples: readonly number[], fs = EEG_FS, lineFreq = 60): BandPowers {
  if (samples.length < 16 || fs <= 0) return { ...ZERO_BANDS };
  return bandPowersFromPsd(welchPsd(preprocess(samples, fs, lineFreq), fs));
}

/** Fraction of in-band power sitting in the mains notch band — high ⇒ bad contact. */
export function mainsRatio(samples: readonly number[], fs = EEG_FS, lineFreq = 60): number {
  if (samples.length < 16 || lineFreq <= 0 || lineFreq >= fs / 2) return 0;
  const { freqs, psd } = welchPsd(detrend(samples), fs); // NOTE: no notch here — measure the mains
  if (freqs.length < 2) return 0;
  let mains = 0, total = 0;
  for (let k = 1; k < freqs.length; k++) {
    const fc = (freqs[k - 1]! + freqs[k]!) / 2;
    const area = ((psd[k - 1]! + psd[k]!) / 2) * (freqs[k]! - freqs[k - 1]!);
    if (fc >= 1 && fc < 45) total += area;
    if (Math.abs(fc - lineFreq) <= 2) mains += area;
  }
  return total > 0 ? mains / total : 0;
}
