import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeBandPowers, focusFeatures, contactQuality, FocusMonitor,
  type FocusReading, type MatchEvent, type NormalizedState,
} from '@dc/shared';
import { NeuroFocusSource, type NeuroFocusStatus } from './neurofocusSource';

export type FocusMode = 'off' | 'device' | 'demo';

const WINDOW = 512;            // ~2 s at 250 Hz — the analysis window
const MAX_BUFFER = 2048;       // ring-buffer cap for raw counts
const TICK_MS = 1000;          // compute focus once per second
const MAX_TIMELINE = 3600;     // up to a ~60-min match at 1 Hz

export interface FocusSession {
  mode: FocusMode;
  setMode: (m: FocusMode) => void;
  status: NeuroFocusStatus | 'demo' | 'off';
  deviceName: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  reading: FocusReading | null;
  timeline: FocusReading[];
  events: MatchEvent[];
  recording: boolean;
}

/**
 * Live focus/stress session driven by the NeuroFocus headset (or a demo signal),
 * time-aligned to the GSI match clock. Recording auto-starts while a match is in
 * progress and the timeline resets per match.
 */
export function useFocusSession(state: NormalizedState | null): FocusSession {
  const [mode, setMode] = useState<FocusMode>('off');
  const [status, setStatus] = useState<NeuroFocusStatus | 'demo' | 'off'>('off');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [reading, setReading] = useState<FocusReading | null>(null);
  const [timeline, setTimeline] = useState<FocusReading[]>([]);
  const [events, setEvents] = useState<MatchEvent[]>([]);

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

  const pushSample = useCallback((raw: number) => {
    const buf = buffer.current;
    buf.push(raw);
    if (buf.length > MAX_BUFFER) buf.shift();
    sinceTick.current += 1;
  }, []);

  const connect = useCallback(async () => {
    const src = new NeuroFocusSource(pushSample, (s) => setStatus(s));
    source.current = src;
    setMode('device');
    await src.connect();
    setDeviceName(src.deviceName);
  }, [pushSample]);

  const disconnect = useCallback(async () => {
    await source.current?.disconnect();
    source.current = null;
    setDeviceName(null);
    setMode('off');
    setStatus('off');
  }, []);

  // Reset the per-match timeline + baseline when the match changes.
  useEffect(() => {
    const matchId = state?.matchId ?? null;
    if (matchId !== prevCombat.current.matchId) {
      prevCombat.current = { kills: state?.combat.kills ?? 0, deaths: state?.combat.deaths ?? 0, matchId };
      eventsRef.current = [];
      setEvents([]);
      setTimeline([]);
      monitor.current = new FocusMonitor();
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

  // The ~1 Hz compute loop.
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
        const rate = Math.min(512, Math.max(120, sinceTick.current / dt)); // measured sps
        sinceTick.current = 0;
        const win = buf.slice(-WINDOW);
        quality = contactQuality(win);
        features = focusFeatures(computeBandPowers(win, rate));
      }

      const r = monitor.current.push({ t: clock, features, quality, recentDeaths, inFight });
      setReading(r);
      // Record into the timeline while a match is live (or always, in demo).
      if (mode === 'demo' || s?.inProgress) {
        setTimeline((prev) => {
          const next = prev.length >= MAX_TIMELINE ? prev.slice(1) : prev.slice();
          next.push(r);
          return next;
        });
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [mode]);

  const recording = mode === 'demo' || (mode !== 'off' && (state?.inProgress ?? false));
  return { mode, setMode, status, deviceName, connect, disconnect, reading, timeline, events, recording };
}
