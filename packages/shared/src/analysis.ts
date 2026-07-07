/**
 * NeuroFocus Intelligence deep analysis — the pure context builder. Takes a
 * recorded session (1 Hz FlowState timeline + match events) and boils it down
 * to an LLM-sized summary: 15 s focus buckets, the event log, aggregates, and
 * an optional slice of the OpenDota match. The listener's /analysis route sends
 * this to the model; nothing here does I/O.
 */
import type { RecordedSession } from './session';
import { findCrash } from './eeg';

export const BUCKET_SEC = 15;
/** Serialized-context budget (chars) the /analysis route holds us to (~4K tokens). */
export const ANALYSIS_CONTEXT_MAX_CHARS = 16_000;

export interface FocusBucket {
  t: number;         // bucket start, game-clock seconds
  focusAvg: number;
  focusMin: number;
  stressAvg: number;
  tiltMax: number;
}

export interface AnalysisContext {
  matchId: string | null;
  durationSec: number;
  stats: {
    focusAvg: number;
    focusMin: number;
    stressAvg: number;
    tiltedPct: number;    // % of points with state === 'tilted'
    deaths: number;
    kills: number;
    /** The heuristic's headline dip, for the model to confirm or refute. */
    crash: { at: number; from: number; to: number; deathAt: number } | null;
  };
  /** 15-second FlowState buckets across the session. */
  buckets: FocusBucket[];
  /** Full event log: kill/death/assist/level_up/battle/day/night/game_*. */
  events: { t: number; kind: string; value?: number }[];
  /** Optional OpenDota slice: team gold advantage every 2 minutes (radiant-positive). */
  goldAdvantage?: { t: number; gold: number }[];
}

const round = (n: number): number => Math.round(n * 10) / 10;

/** Minimal shape we read off an OpenDota match payload. */
export interface OdMatchSlice { radiant_gold_adv?: number[] }

export function buildAnalysisContext(session: RecordedSession, odMatch?: OdMatchSlice): AnalysisContext {
  const points = session.focus;

  const buckets: FocusBucket[] = [];
  let bucket: { t: number; focus: number[]; stress: number[]; tilt: number[] } | null = null;
  const flush = (): void => {
    if (!bucket || bucket.focus.length === 0) return;
    buckets.push({
      t: bucket.t,
      focusAvg: round(bucket.focus.reduce((a, b) => a + b, 0) / bucket.focus.length),
      focusMin: Math.min(...bucket.focus),
      stressAvg: round(bucket.stress.reduce((a, b) => a + b, 0) / bucket.stress.length),
      tiltMax: Math.max(...bucket.tilt),
    });
  };
  for (const p of points) {
    const start = Math.floor(p.t / BUCKET_SEC) * BUCKET_SEC;
    if (!bucket || bucket.t !== start) {
      flush();
      bucket = { t: start, focus: [], stress: [], tilt: [] };
    }
    bucket.focus.push(p.focus);
    bucket.stress.push(p.stress);
    bucket.tilt.push(p.tilt);
  }
  flush();

  const focusVals = points.map((p) => p.focus);
  const stressVals = points.map((p) => p.stress);
  const tilted = points.filter((p) => p.state === 'TILTED').length;
  const crash = findCrash(
    points.map((p) => ({
      t: p.t, focusScore: p.focus, stressScore: p.stress,
      focusZ: 0, stressZ: 0, state: p.state, tilt: p.tilt, quality: p.quality,
    })),
    session.events,
  );

  const context: AnalysisContext = {
    matchId: session.matchId ?? null,
    durationSec: session.durationSec,
    stats: {
      focusAvg: focusVals.length > 0 ? round(focusVals.reduce((a, b) => a + b, 0) / focusVals.length) : 0,
      focusMin: focusVals.length > 0 ? Math.min(...focusVals) : 0,
      stressAvg: stressVals.length > 0 ? round(stressVals.reduce((a, b) => a + b, 0) / stressVals.length) : 0,
      tiltedPct: points.length > 0 ? round((tilted / points.length) * 100) : 0,
      deaths: session.events.filter((e) => e.kind === 'death').length,
      kills: session.events.filter((e) => e.kind === 'kill').length,
      crash,
    },
    buckets,
    events: session.events.map((e) => (e.value !== undefined ? { t: e.t, kind: e.kind, value: e.value } : { t: e.t, kind: e.kind })),
  };

  // radiant_gold_adv is per-minute; sample every 2 min to stay compact.
  const adv = odMatch?.radiant_gold_adv;
  if (Array.isArray(adv) && adv.length > 0) {
    context.goldAdvantage = adv
      .map((gold, minute) => ({ t: minute * 60, gold }))
      .filter((_, i) => i % 2 === 0);
  }

  // Never exceed the budget: shed bucket resolution before anything else.
  while (JSON.stringify(context).length > ANALYSIS_CONTEXT_MAX_CHARS && context.buckets.length > 40) {
    context.buckets = context.buckets.filter((_, i) => i % 2 === 0);
  }
  return context;
}
