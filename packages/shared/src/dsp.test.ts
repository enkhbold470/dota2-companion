import { describe, it, expect } from 'vitest';
import {
  EEG_FS, bandPowers, welchPsd, preprocess, detrend, countsToMicrovolts, mainsRatio, BAND_HZ,
} from './dsp';

/** Sine at `hz`, sampled at fs=175, on a realistic ADS1220 DC offset. */
function sine(hz: number, amp = 1000, n = 700, fs = EEG_FS, offset = 4_000_000): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(offset + amp * Math.sin((2 * Math.PI * hz * i) / fs));
  return out;
}

describe('sample rate', () => {
  it('is 175 (the load-bearing constant)', () => {
    expect(EEG_FS).toBe(175);
  });
});

describe('bandPowers at fs=175', () => {
  it('puts a 10 Hz tone in alpha — the exact bug 600 SPS would cause', () => {
    const bp = bandPowers(sine(10), EEG_FS, 60);
    const top = Object.entries(bp).sort((a, b) => b[1] - a[1])[0]![0];
    expect(top).toBe('alpha');
  });

  it('puts a 6 Hz tone in theta and a 22 Hz tone in beta', () => {
    expect(Object.entries(bandPowers(sine(6), EEG_FS)).sort((a, b) => b[1] - a[1])[0]![0]).toBe('theta');
    expect(Object.entries(bandPowers(sine(22), EEG_FS)).sort((a, b) => b[1] - a[1])[0]![0]).toBe('beta');
  });

  it('would misclassify if fs were wrongly 600 (proves fs matters)', () => {
    // Same 10 Hz samples, but telling the DSP fs=600 shifts the apparent peak up
    // out of alpha — the silent corruption we are guarding against.
    const wrong = bandPowers(sine(10), 600, 0);
    expect(Object.entries(wrong).sort((a, b) => b[1] - a[1])[0]![0]).not.toBe('alpha');
  });

  it('returns zeros for a too-short window', () => {
    expect(bandPowers([1, 2, 3], EEG_FS)).toEqual({ delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 });
  });
});

describe('mains notch', () => {
  it('band-pass + notch suppress 60 Hz relative to no filtering', () => {
    const s = sine(60, 3000);
    const raw = welchPsd(detrend(s), EEG_FS);           // unfiltered
    const clean = welchPsd(preprocess(s, EEG_FS, 60), EEG_FS); // notched + band-passed
    const at = (psd: { freqs: number[]; psd: number[] }, hz: number) => {
      let bi = 0, bd = Infinity;
      psd.freqs.forEach((f, i) => { const d = Math.abs(f - hz); if (d < bd) { bd = d; bi = i; } });
      return psd.psd[bi]!;
    };
    expect(at(clean, 60)).toBeLessThan(at(raw, 60) * 0.2);
  });

  it('mainsRatio is high for a pure 60 Hz tone, low for a 10 Hz tone', () => {
    expect(mainsRatio(sine(60, 2000), EEG_FS, 60)).toBeGreaterThan(0.5);
    expect(mainsRatio(sine(10, 2000), EEG_FS, 60)).toBeLessThan(0.1);
  });
});

describe('countsToMicrovolts', () => {
  it('matches the firmware LSB (3.3V / 2^23 ≈ 0.393 µV per count at gain 1)', () => {
    expect(countsToMicrovolts(1)).toBeCloseTo(0.39339, 4);
    expect(countsToMicrovolts(1000)).toBeCloseTo(393.39, 1);
  });

  it('scales down by the AFE gain', () => {
    expect(countsToMicrovolts(1000, { vref: 3.3, pgaGain: 1, afeGain: 100 })).toBeCloseTo(3.9339, 3);
  });
});

describe('detrend', () => {
  it('removes a linear ramp to ~zero', () => {
    const ramp = Array.from({ length: 100 }, (_, i) => 5 + 2 * i);
    const out = detrend(ramp);
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(1e-6);
  });
});

describe('band table', () => {
  it('matches the doc §2.3 edges', () => {
    expect(BAND_HZ).toEqual({ delta: [1, 4], theta: [4, 8], alpha: [8, 12], beta: [13, 30], gamma: [30, 45] });
  });
});
