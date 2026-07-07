/**
 * The device-agnostic EEGSource abstraction from NEUROFOCUS_BIOMETRIC_LAYER.md
 * §2.1. The companion never couples to one vendor: every headset is "a stream of
 * a derived focus/stress vector + a contact-quality signal". This file provides
 * the interface, a real Web Bluetooth adapter for the NeuroFocus V4 board, and
 * the aspirational neurofocus.dev stub (§2.2) behind the same shape.
 *
 * Raw-counts → band-power DSP lives in @dc/shared (dsp.ts / eeg.ts); this file is
 * transport + windowing only, so the tested pure core stays framework-free.
 */
import { deriveMetric, EEG_FS, type MetricSample } from '@dc/shared';
import { NeuroFocusSource, type NeuroFocusStatus, bluetoothAvailable } from './neurofocusSource';

export type { MetricSample };

export interface Capabilities {
  hasNativeMetrics: boolean;
  channels: number;
  sampleRateHz: number;
  sites: string[];
}

export type ContactQuality = 0 | 1 | 2 | 3;

export interface EEGSource {
  connect(): Promise<void>;
  onMetric(cb: (m: MetricSample) => void): void;
  onContactQuality(cb: (q: ContactQuality) => void): void;
  disconnect(): Promise<void>;
  capabilities(): Capabilities;
}

// A 4 s window, recomputed every 0.5 s (~2 Hz output) — the §2.4 latency budget.
const WINDOW_SEC = 4;
const UPDATE_SEC = 0.5;

export interface WebBluetoothOptions {
  /** Mains frequency to notch: 60 (NA) or 50 (EU/Asia). */
  lineFreq?: number;
  onStatus?: (s: NeuroFocusStatus) => void;
}

/**
 * Real EEGSource for the NeuroFocus V4 over Web Bluetooth. Wraps the transport
 * (frame decode) and feeds a rolling raw-counts ring buffer into the shared DSP,
 * emitting a derived MetricSample at ~2 Hz. It is NOT a native-metrics device —
 * a single ear/forehead channel yields a coarse proxy, so source is 'derived'.
 */
export class WebBluetoothEEGSource implements EEGSource {
  private readonly src: NeuroFocusSource;
  private readonly ring: number[] = [];
  private readonly cap = Math.round(EEG_FS * WINDOW_SEC);
  private metricCb: ((m: MetricSample) => void) | null = null;
  private qualityCb: ((q: ContactQuality) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastQuality: ContactQuality | null = null;
  private readonly lineFreq: number;
  private t = 0;

  constructor(opts: WebBluetoothOptions = {}) {
    this.lineFreq = opts.lineFreq ?? 60;
    this.src = new NeuroFocusSource((raw) => this.push(raw), opts.onStatus);
  }

  static available(): boolean { return bluetoothAvailable(); }

  get deviceName(): string | null { return this.src.deviceName; }

  private push(raw: number): void {
    this.ring.push(raw);
    if (this.ring.length > this.cap) this.ring.shift();
  }

  private tick(): void {
    if (this.ring.length < EEG_FS) return; // need ≥1 s before the first metric
    // fs is HARDCODED to EEG_FS (175). The board's nominal rate is fixed; do not
    // "measure" it off arrival timing — BLE jitter would wobble the frequency axis.
    const m = deriveMetric(this.ring, this.t, EEG_FS, this.lineFreq);
    this.t += UPDATE_SEC;
    if (this.lastQuality !== m.quality) { this.lastQuality = m.quality; this.qualityCb?.(m.quality); }
    this.metricCb?.(m);
  }

  async connect(): Promise<void> {
    await this.src.connect();
    this.timer ??= setInterval(() => this.tick(), UPDATE_SEC * 1000);
  }

  onMetric(cb: (m: MetricSample) => void): void { this.metricCb = cb; }
  onContactQuality(cb: (q: ContactQuality) => void): void { this.qualityCb = cb; }

  capabilities(): Capabilities {
    return { hasNativeMetrics: false, channels: 1, sampleRateHz: EEG_FS, sites: ['Fp1/ear'] };
  }

  async disconnect(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.ring.length = 0;
    this.lastQuality = null;
    this.t = 0;
    await this.src.disconnect();
  }
}

/**
 * neurofocus.dev cloud/SDK adapter — a STUB (§2.2). No SDK, docs, or hardware
 * exist; kept behind the same interface so the app can list it as a future
 * option without pretending it works. connect() rejects loudly.
 */
export class StubEEGSource implements EEGSource {
  async connect(): Promise<void> {
    throw new Error('neurofocus.dev SDK adapter is not available yet — use the Web Bluetooth headset.');
  }
  onMetric(): void { /* never emits */ }
  onContactQuality(): void { /* never emits */ }
  async disconnect(): Promise<void> { /* no-op */ }
  capabilities(): Capabilities {
    return { hasNativeMetrics: false, channels: 1, sampleRateHz: 0, sites: ['TP9/TP10 (claimed)'] };
  }
}
