/**
 * Recorded-session files (the JSON the listener writes on Stop & save) and the
 * game-clock ↔ wall-clock bridge that lets the review UI seek a screen recording
 * to the moment focus dropped.
 *
 * Focus points and match events are tagged with the GSI game clock (`t`, seconds,
 * negative before the horn) so they align with each other. A video file only
 * knows wall-clock time. v2 sessions therefore stamp every stored point/event
 * with `tMs` (epoch ms) at capture time; v1 sessions lack the stamps, so we
 * synthesize them from the 1 Hz capture cadence (point i ≈ startedAtMs + i·1000).
 * Everything here is pure and I/O-free.
 */
import type { MentalState, GameEventKind } from './eeg';

export const SESSION_FORMAT_V2 = 'neurofocus_ble_eeg_v2';

/** One 1 Hz focus point as stored on disk (remapped from FocusReading). */
export interface StoredFocusPoint {
  t: number;            // game-clock seconds
  tMs?: number;         // wall-clock epoch ms at capture (v2)
  focus: number;        // 0..100
  stress: number;       // 0..100
  state: MentalState;
  tilt: number;
  quality: 0 | 1 | 2 | 3;
}

export interface StoredMatchEvent {
  t: number;
  tMs?: number;         // wall-clock epoch ms at capture (v2)
  kind: GameEventKind;
  value?: number;
}

/** Screen recording saved alongside the session JSON (same basename, .webm). */
export interface SessionVideoMeta {
  filename: string;
  startedAtMs: number;  // wall clock when MediaRecorder started
  mimeType?: string;
}

export interface RecordedSession {
  format: string;       // neurofocus_ble_eeg_v1 | _v2
  app?: string;
  startedAtMs: number;
  endedAtMs: number;
  durationSec: number;
  source?: string;
  device?: string | null;
  sampleRateHz?: number | null;
  truncated?: boolean;
  matchId?: string | null;
  video?: SessionVideoMeta | null;
  focus: StoredFocusPoint[];
  events: StoredMatchEvent[];
  samples?: number[];
}

/** Tolerant reader for a saved session file. Returns null when it isn't one. */
export function parseRecordedSession(raw: unknown): RecordedSession | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.format !== 'string' || !s.format.startsWith('neurofocus_ble_eeg')) return null;
  if (typeof s.startedAtMs !== 'number') return null;
  const v = s.video as Record<string, unknown> | null | undefined;
  const video = (typeof v === 'object' && v !== null
    && typeof v.filename === 'string' && typeof v.startedAtMs === 'number')
    ? (v as unknown as SessionVideoMeta)
    : null;
  return {
    ...(s as unknown as RecordedSession),
    endedAtMs: typeof s.endedAtMs === 'number' ? s.endedAtMs : s.startedAtMs,
    durationSec: typeof s.durationSec === 'number' ? s.durationSec : 0,
    focus: Array.isArray(s.focus) ? (s.focus as StoredFocusPoint[]) : [],
    events: Array.isArray(s.events) ? (s.events as StoredMatchEvent[]) : [],
    video,
  };
}

export interface SessionAnchor { t: number; ms: number }

/**
 * Bidirectional game-clock ↔ wall-clock map. Anchors are dense (1 Hz), so
 * nearest-anchor interpolation stays honest across pauses, pre-horn negative
 * clocks, and the performance.now() fallback used when GSI is absent.
 */
export interface SessionTimeMap {
  anchors: SessionAnchor[];
  msAtClock(t: number): number;
  clockAtMs(ms: number): number;
}

export function sessionTimeMap(
  session: Pick<RecordedSession, 'focus' | 'events' | 'startedAtMs'>,
): SessionTimeMap | null {
  let anchors: SessionAnchor[] = session.focus
    .filter((p) => typeof p.tMs === 'number')
    .map((p) => ({ t: p.t, ms: p.tMs! }));
  if (anchors.length === 0) {
    anchors = session.events
      .filter((e) => typeof e.tMs === 'number')
      .map((e) => ({ t: e.t, ms: e.tMs! }));
  }
  if (anchors.length === 0 && session.focus.length > 0) {
    // v1 fallback: the compute loop appended one point per second from Start.
    anchors = session.focus.map((p, i) => ({ t: p.t, ms: session.startedAtMs + i * 1000 }));
  }
  if (anchors.length === 0) return null;
  anchors.sort((a, b) => a.ms - b.ms);

  const msAtClock = (t: number): number => {
    let best = anchors[0]!;
    let bd = Math.abs(t - best.t);
    for (const a of anchors) {
      const d = Math.abs(t - a.t);
      if (d < bd) { bd = d; best = a; }
    }
    return best.ms + (t - best.t) * 1000;
  };

  const clockAtMs = (ms: number): number => {
    // anchors are ms-sorted — interpolate between the bracketing pair, so a
    // paused game clock reads flat instead of drifting with wall time.
    const first = anchors[0]!;
    const last = anchors[anchors.length - 1]!;
    if (ms <= first.ms) return first.t + (ms - first.ms) / 1000;
    if (ms >= last.ms) return last.t + (ms - last.ms) / 1000;
    let lo = 0;
    let hi = anchors.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (anchors[mid]!.ms < ms) lo = mid + 1;
      else hi = mid;
    }
    const after = anchors[lo]!;
    const before = anchors[lo - 1]!;
    const span = after.ms - before.ms;
    if (span <= 0) return after.t;
    return before.t + (after.t - before.t) * ((ms - before.ms) / span);
  };

  return { anchors, msAtClock, clockAtMs };
}

/** Seconds into the video where game-clock `t` happened (clamped to ≥ 0). */
export function videoOffsetSec(map: SessionTimeMap, video: SessionVideoMeta, t: number): number {
  return Math.max(0, (map.msAtClock(t) - video.startedAtMs) / 1000);
}

/** Game clock at `sec` seconds into the video — drives the timeline playhead. */
export function clockAtVideoSec(map: SessionTimeMap, video: SessionVideoMeta, sec: number): number {
  return map.clockAtMs(video.startedAtMs + sec * 1000);
}

export interface SessionHead {
  format: string | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
  durationSec: number | null;
  source: string | null;
  matchId: string | null;
  video: SessionVideoMeta | null;
}

/**
 * Extract listing metadata from the FIRST bytes of a session file without
 * parsing the whole thing (files carry up to ~2 M raw samples). Works because
 * the writer emits all scalar metadata and `video` before the big arrays.
 * Top-level "startedAtMs" precedes video's, so first-match regexes are safe.
 */
export function parseSessionHead(head: string): SessionHead {
  const num = (key: string): number | null => {
    const m = head.match(new RegExp(`"${key}":(-?[\\d.]+)`));
    return m ? Number(m[1]) : null;
  };
  const str = (key: string): string | null => {
    const m = head.match(new RegExp(`"${key}":"([^"]*)"`));
    return m ? m[1]! : null;
  };
  let video: SessionVideoMeta | null = null;
  const vm = head.match(/"video":\{([^{}]*)\}/);
  if (vm) {
    try {
      const v = JSON.parse(`{${vm[1]}}`) as Record<string, unknown>;
      if (typeof v.filename === 'string' && typeof v.startedAtMs === 'number') {
        video = v as unknown as SessionVideoMeta;
      }
    } catch { /* malformed head — no video meta */ }
  }
  return {
    format: str('format'),
    startedAtMs: num('startedAtMs'),
    endedAtMs: num('endedAtMs'),
    durationSec: num('durationSec'),
    source: str('source'),
    matchId: str('matchId'),
    video,
  };
}
