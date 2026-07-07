import { describe, it, expect } from 'vitest';
import { WebBluetoothEEGSource, StubEEGSource } from './eegSource';

describe('WebBluetoothEEGSource', () => {
  it('reports single-channel derived capabilities at 175 SPS', () => {
    const cap = new WebBluetoothEEGSource().capabilities();
    expect(cap).toEqual({ hasNativeMetrics: false, channels: 1, sampleRateHz: 175, sites: ['Fp1/ear'] });
  });
});

describe('StubEEGSource', () => {
  it('rejects connect() loudly — the neurofocus.dev SDK does not exist', async () => {
    await expect(new StubEEGSource().connect()).rejects.toThrow(/not available yet/);
  });
  it('advertises no real sample rate', () => {
    expect(new StubEEGSource().capabilities().sampleRateHz).toBe(0);
  });
});
