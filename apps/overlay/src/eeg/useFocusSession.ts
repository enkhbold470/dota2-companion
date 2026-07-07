import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeBandPowers, focusFeatures, contactQuality, FocusMonitor, deriveEvents,
  SESSION_FORMAT_V2, EEG_FS,
  type FocusReading, type MatchEvent, type NormalizedState, type SessionVideoMeta,
} from '@dc/shared';
import { RECORDING_URL } from '../config';
import { getRawDataPath } from '../components/SettingsPanel';
import { NeuroFocusSource, type NeuroFocusStatus } from './neurofocusSource';
import { ScreenRecorder } from '../video/screenRecorder';

export type FocusMode = 'off' | 'device' | 'demo';

/** Wall-clock stamps let the review UI map game-clock t → video seek offset. */
type StampedReading = FocusReading & { tMs: number };
type StampedEvent = MatchEvent & { tMs?: number };

const AUTO_RECORD_KEY = 'nf.autoRecord';

const WINDOW = 700;              // 4 s at 175 SPS — the analysis window (df ≈ 0.25 Hz)
const LINE_FREQ = 60;            // mains to notch in software (60 NA / 50 EU)
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
  /** Screen capture is armed (stream held); recordings will include video. */
  captureArmed: boolean;
  /** A video is being written right now (recording && armed at start time). */
  videoRecording: boolean;
  armCapture: () => Promise<void>;
  disarmCapture: () => void;
  /** Grab one still JPEG data-URL from the armed capture (null if not armed). */
  grabFrame: () => Promise<string | null>;
  /** Start/stop recording automatically at the game horn / game end. */
  autoRecord: boolean;
  setAutoRecord: (v: boolean) => void;
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
  const [captureArmed, setCaptureArmed] = useState(false);
  const [videoRecording, setVideoRecording] = useState(false);
  const [autoRecord, setAutoRecordState] = useState<boolean>(() => {
    try { return localStorage.getItem(AUTO_RECORD_KEY) === '1'; } catch { return false; }
  });

  const buffer = useRef<number[]>([]);
  const sinceTick = useRef(0);
  const monitor = useRef(new FocusMonitor());
  const source = useRef<NeuroFocusSource | null>(null);
  // Latest GSI, read inside the interval without re-subscribing.
  const gsi = useRef<NormalizedState | null>(state);
  gsi.current = state;
  const prevState = useRef<NormalizedState | null>(null);
  const eventsRef = useRef<StampedEvent[]>([]);
  const demoPhase = useRef(0);

  // Recording state, held in refs so the sample handler / interval read it live.
  const recordingRef = useRef(false);
  const recordRaw = useRef<number[]>([]);
  const recordedRef = useRef<StampedReading[]>([]);
  const recordStartMs = useRef<number | null>(null);
  const recordTruncated = useRef(false);
  // Basename shared by the session .json and its .webm, fixed at Start.
  const recordBase = useRef<string | null>(null);
  const videoMeta = useRef<SessionVideoMeta | null>(null);

  // One screen recorder for the app's lifetime; mirror its state into React.
  const screenRec = useRef<ScreenRecorder | null>(null);
  if (!screenRec.current) screenRec.current = new ScreenRecorder();
  screenRec.current.onChange = () => {
    setCaptureArmed(screenRec.current!.armed);
    setVideoRecording(screenRec.current!.recording);
  };

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

  const armCapture = useCallback(async () => { await screenRec.current!.arm(); }, []);
  const disarmCapture = useCallback(() => { screenRec.current!.disarm(); }, []);
  const grabFrame = useCallback(() => screenRec.current!.grabFrame(), []);
  const setAutoRecord = useCallback((v: boolean) => {
    setAutoRecordState(v);
    try { localStorage.setItem(AUTO_RECORD_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  const startRecording = useCallback(() => {
    recordRaw.current = [];
    recordedRef.current = [];
    recordTruncated.current = false;
    recordStartMs.current = Date.now();
    recordBase.current = `neurofocus-dota-${new Date(recordStartMs.current).toISOString().replace(/[:.]/g, '-')}`;
    setRecordStartedMs(recordStartMs.current);
    setSampleCount(0);
    setTimeline([]);
    setLastSave(null);
    recordingRef.current = true;
    setRecording(true);
    // Screen capture rides along when armed — best-effort and async so the EEG
    // recording starts instantly either way.
    videoMeta.current = null;
    const rec = screenRec.current!;
    if (rec.armed) {
      void rec.start(`${recordBase.current}.webm`, getRawDataPath() || undefined)
        .then((v) => {
          if (v) videoMeta.current = { filename: v.filename, startedAtMs: v.startedAtMs, mimeType: v.mimeType };
        });
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);

    // Flush the screen recording first so its tail chunk is on disk before the
    // session JSON that references it.
    if (screenRec.current!.recording) await screenRec.current!.stop();

    const startedAtMs = recordStartMs.current ?? Date.now();
    const endedAtMs = Date.now();
    const durationSec = Math.max(1, (endedAtMs - startedAtMs) / 1000);
    const samples = recordRaw.current;
    const sampleRateHz = mode === 'device' && samples.length > 0
      ? Number((samples.length / durationSec).toFixed(2))
      : null;

    // Key order matters: scalars + video before the big arrays, samples last, so
    // the listing route can read metadata from just the file head (parseSessionHead).
    const session = {
      format: SESSION_FORMAT_V2,
      app: 'dota2-companion',
      startedAtMs, endedAtMs, durationSec,
      source: mode,
      device: deviceName,
      sampleRateHz,
      truncated: recordTruncated.current,
      matchId: gsi.current?.matchId ?? null,
      video: videoMeta.current,
      focus: recordedRef.current.map((r) => ({
        t: r.t, tMs: r.tMs, focus: r.focusScore, stress: r.stressScore, state: r.state, tilt: r.tilt, quality: r.quality,
      })),
      events: eventsRef.current,
      samples,
    };
    const base = recordBase.current
      ?? `neurofocus-dota-${new Date(startedAtMs).toISOString().replace(/[:.]/g, '-')}`;
    const filename = `${base}.json`;

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

  // Diff successive GSI snapshots into match events (kills, deaths, respawns,
  // level-ups, battles, day/night). On a match change we rebaseline + clear —
  // but never mid-recording, since a deliberate recording may span boundaries.
  useEffect(() => {
    if (!state) return;
    const prev = prevState.current;
    const matchChanged = (prev?.matchId ?? null) !== (state.matchId ?? null);
    if (matchChanged && !recordingRef.current) {
      eventsRef.current = [];
      setEvents([]);
      setLive([]);
      monitor.current = new FocusMonitor();
      prevState.current = state;   // fresh start — no phantom deltas this tick
      return;
    }
    const evs = deriveEvents(prev, state);
    prevState.current = state;
    if (evs.length) {
      const now = Date.now();
      eventsRef.current = [...eventsRef.current, ...evs.map((e) => ({ ...e, tMs: now }))];
      setEvents(eventsRef.current);
    }
  }, [state]);

  // Auto-record: start at the horn, stop & save at game end. Only sessions this
  // effect started are auto-stopped — a manual recording is never cut short.
  const autoRecordRef = useRef(autoRecord);
  autoRecordRef.current = autoRecord;
  const autoStarted = useRef(false);
  const prevInProgress = useRef(false);
  useEffect(() => {
    if (!state) return;
    const was = prevInProgress.current;
    prevInProgress.current = state.inProgress;
    if (!autoRecordRef.current || mode === 'off') return;
    if (!was && state.inProgress && !recordingRef.current) {
      autoStarted.current = true;
      startRecording();
    } else if (was && !state.inProgress && autoStarted.current && recordingRef.current) {
      autoStarted.current = false;
      void stopRecording();
    }
  }, [state, mode, startRecording, stopRecording]);

  // The ~1 Hz compute loop — always streams focus while a source is live.
  useEffect(() => {
    if (mode === 'off') { setStatus('off'); return; }
    if (mode === 'demo') setStatus('demo');

    const id = setInterval(() => {
      const s = gsi.current;
      const clock = s?.clock ?? Math.floor(performance.now() / 1000);
      const recentDeaths = eventsRef.current.filter((e) => e.kind === 'death' && clock - e.t <= 60).length;
      const inFight = eventsRef.current.some((e) =>
        (e.kind === 'battle' || e.kind === 'kill' || e.kind === 'death') && clock - e.t <= 10)
        || s?.hero.alive === false;

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
        // Sprinkle synthetic events so "Try demo" shows the event-overlaid timeline.
        if (recordingRef.current) {
          const add: StampedEvent[] = [];
          if (p % 23 === 0) add.push({ t: clock, kind: p % 46 === 0 ? 'death' : 'kill', tMs: Date.now() });
          if (p % 9 === 0) add.push({ t: clock, kind: 'battle', value: 45, tMs: Date.now() });
          if (add.length) { eventsRef.current = [...eventsRef.current, ...add]; setEvents(eventsRef.current); }
        }
      } else {
        const buf = buffer.current;
        if (buf.length < 64) return;               // not enough signal yet
        sinceTick.current = 0;
        // fs is FIXED at 175 SPS (ADS1220 DR_LVL_3, verified against firmware).
        // Do NOT measure the rate off arrival timing — BLE jitter would wobble the
        // frequency axis and silently corrupt every band. See @dc/shared EEG_FS.
        const win = buf.slice(-WINDOW);
        quality = contactQuality(win, EEG_FS, LINE_FREQ);
        features = focusFeatures(computeBandPowers(win, EEG_FS, LINE_FREQ));
      }

      const r = monitor.current.push({ t: clock, features, quality, recentDeaths, inFight });
      setReading(r);

      // Always feed the rolling live buffer that powers the on-side strip.
      setLive((prev) => {
        const next = prev.length >= LIVE_WINDOW ? prev.slice(prev.length - LIVE_WINDOW + 1) : prev.slice();
        next.push(r);
        return next;
      });

      // Only accumulate the recorded timeline while the user is recording. The
      // wall-clock stamp is what lets the review UI seek video to this moment.
      if (recordingRef.current) {
        const rec = recordedRef.current;
        rec.push({ ...r, tMs: Date.now() });
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
    captureArmed, videoRecording, armCapture, disarmCapture, grabFrame, autoRecord, setAutoRecord,
  };
}
