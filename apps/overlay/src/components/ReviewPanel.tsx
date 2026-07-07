import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  parseRecordedSession, sessionTimeMap, videoOffsetSec, clockAtVideoSec, findCrash, formatClock,
  type RecordedSession, type SessionHead, type FocusReading, type MatchEvent,
} from '@dc/shared';
import { RECORDINGS_URL, RECORDING_FILE_URL } from '../config';
import { getRawDataPath } from './SettingsPanel';
import { t, btn, SectionLabel } from '../theme';
import { FocusTimeline } from './FocusTimeline';

interface SessionEntry { name: string; size: number; mtimeMs: number; head: SessionHead | null }
interface VideoEntry { name: string; size: number }
interface Listing { sessions: SessionEntry[]; videos: VideoEntry[] }

function fileUrl(name: string): string {
  const dir = getRawDataPath();
  return `${RECORDING_FILE_URL}?name=${encodeURIComponent(name)}${dir ? `&dir=${encodeURIComponent(dir)}` : ''}`;
}

function listUrl(): string {
  const dir = getRawDataPath();
  return dir ? `${RECORDINGS_URL}?dir=${encodeURIComponent(dir)}` : RECORDINGS_URL;
}

function fmtWhen(ms: number | null): string {
  if (ms == null) return '—';
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function fmtDur(sec: number | null): string {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  return `${m}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;
}

/**
 * Post-game review: pick a saved session, watch its screen recording, and click
 * anywhere on the focus timeline (or a moment chip) to seek the video to that
 * game-clock second. The playhead follows the video as it plays. Sessions and
 * video never leave this machine — the listener serves them from the local
 * recordings folder.
 */
export function ReviewPanel({ refreshKey }: { refreshKey?: unknown }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [listError, setListError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [session, setSession] = useState<RecordedSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [cursorT, setCursorT] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const refresh = useCallback(() => {
    fetch(listUrl())
      .then((r) => (r.ok ? (r.json() as Promise<Listing>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => { setListing(d); setListError(false); })
      .catch(() => setListError(true));
  }, []);

  // Refresh on mount and whenever a recording is saved (refreshKey flips).
  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  const open = useCallback((name: string) => {
    setSelected(name);
    setSession(null);
    setCursorT(null);
    setLoading(true);
    fetch(fileUrl(name))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((raw) => setSession(parseRecordedSession(raw)))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  const map = useMemo(() => (session ? sessionTimeMap(session) : null), [session]);
  const videoName = session?.video?.filename ?? null;
  const videoAvailable = videoName != null
    && (listing?.videos.some((v) => v.name === videoName && v.size > 0) ?? false);

  const timeline: FocusReading[] = useMemo(() => (session?.focus ?? []).map((p) => ({
    t: p.t, focusScore: p.focus, stressScore: p.stress,
    focusZ: 0, stressZ: 0, quality: p.quality, state: p.state, tilt: p.tilt,
  })), [session]);
  const events: MatchEvent[] = session?.events ?? [];
  const crash = useMemo(() => findCrash(timeline, events), [timeline, events]);

  const seek = useCallback((tt: number) => {
    setCursorT(tt);
    const el = videoRef.current;
    if (!el || !map || !session?.video) return;
    el.currentTime = videoOffsetSec(map, session.video, tt);
  }, [map, session]);

  const onTimeUpdate = useCallback(() => {
    const el = videoRef.current;
    if (!el || !map || !session?.video) return;
    setCursorT(clockAtVideoSec(map, session.video, el.currentTime));
  }, [map, session]);

  const moments = useMemo(() => {
    const out: { label: string; t: number }[] = [];
    if (crash) out.push({ label: `Focus crash ${formatClock(crash.at)}`, t: crash.deathAt });
    for (const e of events) {
      if (e.kind === 'death') out.push({ label: `Death ${formatClock(e.t)}`, t: e.t });
    }
    return out.slice(0, 8);
  }, [crash, events]);

  const sessions = listing?.sessions ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.md }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: t.space.sm }}>
        <SectionLabel tone="ai">Session review</SectionLabel>
        <button type="button" onClick={refresh} style={{ ...btn('ghost'), marginLeft: 'auto' }}>Refresh</button>
      </div>

      {listError && (
        <div style={{ fontSize: t.font.sm, color: t.brand.stress }}>Couldn’t reach the listener to list recordings.</div>
      )}
      {!listError && sessions.length === 0 && (
        <div style={{ fontSize: t.font.sm, color: t.color.textMuted, lineHeight: t.line.normal }}>
          No saved sessions yet. Record one from the focus strip — with screen capture armed
          (Settings → Gameplay video), the review pairs your focus timeline with the video.
        </div>
      )}

      {sessions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 180, overflowY: 'auto' }}>
          {sessions.map((s) => {
            const active = s.name === selected;
            const hasVideo = s.head?.video != null;
            return (
              <button
                key={s.name} type="button" onClick={() => open(s.name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: t.space.sm, textAlign: 'left',
                  background: active ? t.color.inset : 'transparent',
                  border: `1px solid ${active ? t.color.borderStrong : 'transparent'}`,
                  borderRadius: t.radius.md, padding: `${t.space.xs}px ${t.space.sm}px`,
                  cursor: 'pointer', color: t.color.text, fontSize: t.font.sm,
                }}
              >
                <span>{fmtWhen(s.head?.startedAtMs ?? s.mtimeMs)}</span>
                {s.head?.durationSec != null && (
                  <span style={{ color: t.color.textFaint }}>{fmtDur(s.head.durationSec)}</span>
                )}
                {s.head?.matchId && <span style={{ color: t.color.textFaint }}>match {s.head.matchId}</span>}
                <span style={{ marginLeft: 'auto', color: t.color.textFaint }}>{hasVideo ? '🎥' : ''}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading && <div style={{ fontSize: t.font.sm, color: t.color.textFaint }}>Loading session…</div>}
      {selected && !loading && !session && (
        <div style={{ fontSize: t.font.sm, color: t.brand.stress }}>Couldn’t read that session file.</div>
      )}

      {session && (
        <>
          {videoAvailable && videoName ? (
            <video
              ref={videoRef} controls preload="metadata" onTimeUpdate={onTimeUpdate}
              src={fileUrl(videoName)}
              style={{ width: '100%', borderRadius: t.radius.md, background: '#000', display: 'block' }}
            />
          ) : (
            <div style={{ fontSize: t.font.sm, color: t.color.textFaint }}>
              No screen recording with this session — arm capture in Settings before recording to get one.
            </div>
          )}

          {moments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.space.sm }}>
              {moments.map((m) => (
                <button
                  key={`${m.label}-${m.t}`} type="button" onClick={() => seek(m.t)}
                  style={btn('ghost')} disabled={!videoAvailable && map == null}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          <FocusTimeline
            timeline={timeline}
            events={events}
            onSeek={videoAvailable ? seek : undefined}
            cursorT={cursorT}
          />

          {crash && (
            <div style={{ fontSize: t.font.base, color: t.color.text, lineHeight: t.line.normal }}>
              Focus crashed after the death at <strong>{formatClock(crash.deathAt)}</strong> —{' '}
              <strong style={{ color: t.brand.focus }}>{crash.from} → {crash.to}</strong>.
              {videoAvailable && ' Click it above to watch that moment.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
