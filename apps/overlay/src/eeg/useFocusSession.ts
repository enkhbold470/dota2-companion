import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeBandPowers, focusFeatures, contactQuality, FocusMonitor,
  type FocusReading, type MatchEvent, type NormalizedState,
} from '@dc/shared';
import { RECORDING_URL } from '../config';
import { getRawDataPath } from '../components/SettingsPanel';
import { NeuroFocusSource, type NeuroFocusStatus } from './neurofocusSource';

export type FocusMode = 'off' | 'device' | 'demo';

const WINDOW = 1024;             // ~1.7 s at 600 SPS — the analysis window (df ≈ 0.6 Hz)
const MAX_BUFFER = 4096;         // ring-buffer cap for band-power raw counts
const TICK_MS = 1000;            // compute focus once per second
const LIVE_WINDOW = 180;         // rolling readings kept for the always-on live strip (~3 min)
const MAX_TIMELINE = 5400;       // recorded focus timeline cap (~90 min at 1 Hz)
const MAX_RECORD_SAMPLES = 2_000_000; // raw-sample cap per recording (~133 min at 250 Hz)

export type SaveResult = { ok: true; file: string } | { ok: false; error: string };

export interface FocusSession {
  mode: FocusMode;
  setMode: (m: FocusMode) => void;
  status: NeuroFocusStatus | 'demo' | 'off';
  deviceName: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  reading: FocusReading | null;
  /** Rolling recent readings for the always-on live strip (updates every second). */
  live: FocusReading[];
  /** Readings captured between Start and Stop recording (the deliberate session). */
  timeline: FocusReading[];
  events: MatchEvent[];
  recording: boolean;
  recordStartedMs: number | null;
  sampleCount: number;
  startRecording: () => void;
  stopRecording: () => Promise<void>;
  lastSave: SaveResult | null;
}

/**
 * Live focus/stress session driven by the NeuroFocus headset (or a demo signal).
 *
 * Focus is streamed continuously to a rolling `live` buffer whenever a source is
 * connected. Writing the raw signal to disk is a DELIBERATE, manual act — the user
 * hits Start/Stop — because Dota's match start/end can't be detected reliably from
 * GSI. Between Start and Stop we accumulate raw ADS1220 counts + the 1 Hz focus
 * timeline + kill/death events, then POST the whole session to the listener, which
 * persists it to the configured folder.
 */
export function useFocusSession(state: NormalizedState | null): FocusSession {
  const [mode, setMode] = useState<FocusMode>('off');
  const [status, setStatus] = useState<NeuroFocusStatus | 'demo' | 'off'>('off');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [reading, setReading] = useState<FocusReading | null>(null);
  const [live, setLive] = useState<FocusReading[]>([]);
  const [timeline, setTimeline] = useState<FocusReading[]>([]);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordStartedMs, setRecordStartedMs] = useState<number | null>(null);
  const [sampleCount, setSampleCount] = useState(0);
  const [lastSave, setLastSave] = useState<SaveResult | null>(null);

  const buffer = useRef<number[]>([]);
  const sinceTick = useRef(0);
  const monitor = useRef(new FocusMonitor());
  const source = useRef<NeuroFocusSource | null>(null);
  // Latest GSI, read inside the interval without re-subscribing.
  const gsi = useRef<NormalizedState | null>(state);
  gsi.current = state;
  const prevCombat = useRef<{ kills: number; deaths: number; matchId: string | null }>({ kills: 0, deaths: 0, matchId: null });
  const eventsRef = useRef<MatchEvent[]>([]);
  const demoPhase = useRef(0);

  // Recording state, held in refs so the sample handler / interval read it live.
  const recordingRef = useRef(false);
  const recordRaw = useRef<number[]>([]);
  const recordedRef = useRef<FocusReading[]>([]);
  const recordStartMs = useRef<number | null>(null);
  const recordTruncated = useRef(false);

  const pushSample = useCallback((raw: number) => {
    const buf = buffer.current;
    buf.push(raw);
    if (buf.length > MAX_BUFFER) buf.shift();
    sinceTick.current += 1;
    if (recordingRef.current) {
      const rr = recordRaw.current;
      if (rr.length < MAX_RECORD_SAMPLES) rr.push(raw);
      else recordTruncated.current = true;
    }
  }, []);

  const connect = useCallback(async () => {
    const src = new NeuroFocusSource(pushSample, (s) => setStatus(s));
    source.current = src;
    setMode('device');
    await src.connect();
    setDeviceName(src.deviceName);
  }, [pushSample]);

  const disconnect = useCallback(async () => {
    recordingRef.current = false;
    setRecording(false);
    await source.current?.disconnect();
    source.current = null;
    setDeviceName(null);
    setMode('off');
    setStatus('off');
  }, []);

  const startRecording = useCallback(() => {
    recordRaw.current = [];
    recordedRef.current = [];
    recordTruncated.current = false;
    recordStartMs.current = Date.now();
    setRecordStartedMs(recordStartMs.current);
    setSampleCount(0);
    setTimeline([]);
    setLastSave(null);
    recordingRef.current = true;
    setRecording(true);
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);

    const startedAtMs = recordStartMs.current ?? Date.now();
    const endedAtMs = Date.now();
    const durationSec = Math.max(1, (endedAtMs - startedAtMs) / 1000);
    const samples = recordRaw.current;
    const sampleRateHz = mode === 'device' && samples.length > 0
      ? Number((samples.length / durationSec).toFixed(2))
      : null;

    const session = {
      format: 'neurofocus_ble_eeg_v1',
      app: 'dota2-companion',
      startedAtMs, endedAtMs, durationSec,
      source: mode,
      device: deviceName,
      sampleRateHz,
      truncated: recordTruncated.current,
      matchId: gsi.current?.matchId ?? null,
      samples,
      focus: recordedRef.current.map((r) => ({
        t: r.t, focus: r.focusScore, stress: r.stressScore, state: r.state, tilt: r.tilt, quality: r.quality,
      })),
      events: eventsRef.current,
    };
    const iso = new Date(startedAtMs).toISOString().replace(/[:.]/g, '-');
    const filename = `neurofocus-dota-${iso}.json`;

    try {
      const res = await fetch(RECORDING_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dir: getRawDataPath() || undefined, filename, session }),
      });
      if (!res.ok) { setLastSave({ ok: false, error: `listener returned ${res.status}` }); return; }
      const d = (await res.json()) as { file?: string };
      setLastSave({ ok: true, file: d.file ?? filename });
    } catch {
      setLastSave({ ok: false, error: 'could not reach the listener to save' });
    }
  }, [mode, deviceName]);

  // Rebaseline + clear events when the match changes — but never mid-recording,
  // since a deliberate recording may deliberately span match boundaries.
  useEffect(() => {
    const matchId = state?.matchId ?? null;
    if (matchId !== prevCombat.current.matchId) {
      prevCombat.current.matchId = matchId;
      prevCombat.current.kills = state?.combat.kills ?? prevCombat.current.kills;
      prevCombat.current.deaths = state?.combat.deaths ?? prevCombat.current.deaths;
      if (!recordingRef.current) {
        eventsRef.current = [];
        setEvents([]);
        setLive([]);
        monitor.current = new FocusMonitor();
      }
    }
  }, [state?.matchId, state?.combat.kills, state?.combat.deaths]);

  // Mark kill/death events from GSI deltas, tagged to the match clock.
  useEffect(() => {
    const c = state?.combat;
    if (!c) return;
    const clock = state?.clock ?? 0;
    const kills = c.kills ?? prevCombat.current.kills;
    const deaths = c.deaths ?? prevCombat.current.deaths;
    const newEvents: MatchEvent[] = [];
    if (kills > prevCombat.current.kills) newEvents.push({ t: clock, kind: 'kill' });
    if (deaths > prevCombat.current.deaths) newEvents.push({ t: clock, kind: 'death' });
    if (newEvents.length) {
      eventsRef.current = [...eventsRef.current, ...newEvents];
      setEvents(eventsRef.current);
    }
    prevCombat.current = { ...prevCombat.current, kills, deaths };
  }, [state?.combat, state?.clock]);

  // The ~1 Hz compute loop — always streams focus while a source is live.
  useEffect(() => {
    if (mode === 'off') { setStatus('off'); return; }
    if (mode === 'demo') setStatus('demo');

    const id = setInterval(() => {
      const s = gsi.current;
      const clock = s?.clock ?? Math.floor(performance.now() / 1000);
      const recentDeaths = eventsRef.current.filter((e) => e.kind === 'death' && clock - e.t <= 60).length;
      const inFight = eventsRef.current.some((e) => clock - e.t <= 10) || s?.hero.alive === false;

      let features;
      let quality: 0 | 1 | 2 | 3;
      if (mode === 'demo') {
        // Plausible synthetic features so the whole pipeline (and UI) is alive
        // without hardware — clearly labeled "demo" in the panel.
        demoPhase.current += 1;
        const p = demoPhase.current;
        const dip = recentDeaths > 0 ? 0.5 : 0;
        features = {
          focus: 1.1 + 0.35 * Math.sin(p / 18) - dip + (Math.sin(p * 1.3) * 0.05),
          stressBeta: 0.24 + 0.08 * Math.sin(p / 11) + 0.14 * recentDeaths + (Math.sin(p * 0.7) * 0.02),
          relaxation: 0.2,
        };
        quality = 3;
      } else {
        const buf = buffer.current;
        if (buf.length < 64) return;               // not enough signal yet
        const dt = Math.max(0.5, TICK_MS / 1000);
        // Firmware streams ADS1220 at 600 SPS; measure it live (BLE drops sag it a
        // little) and clamp to a sane band so the periodogram's Hz axis is right.
        const rate = Math.min(700, Math.max(200, sinceTick.current / dt)); // measured sps
        sinceTick.current = 0;
        const win = buf.slice(-WINDOW);
        quality = contactQuality(win);
        features = focusFeatures(computeBandPowers(win, rate));
      }

      const r = monitor.current.push({ t: clock, features, quality, recentDeaths, inFight });
      setReading(r);

      // Always feed the rolling live buffer that powers the on-side strip.
      setLive((prev) => {
        const next = prev.length >= LIVE_WINDOW ? prev.slice(prev.length - LIVE_WINDOW + 1) : prev.slice();
        next.push(r);
        return next;
      });

      // Only accumulate the recorded timeline while the user is recording.
      if (recordingRef.current) {
        const rec = recordedRef.current;
        rec.push(r);
        if (rec.length > MAX_TIMELINE) rec.shift();
        setTimeline(rec.slice());
        setSampleCount(recordRaw.current.length);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [mode]);

  return {
    mode, setMode, status, deviceName, connect, disconnect,
    reading, live, timeline, events,
    recording, recordStartedMs, sampleCount, startRecording, stopRecording, lastSave,
  };
}
