import { useMemo } from 'react';
import { findCrash, formatClock, type FocusReading, type MatchEvent } from '@dc/shared';
import { t, btn, SectionLabel } from '../theme';
import type { FocusSession } from '../eeg/useFocusSession';

const STATE_LABEL: Record<string, string> = {
  UNKNOWN: 'no signal', CALIBRATING: 'calibrating', FOCUSED: 'in flow',
  FOCUS_DIP: 'focus dip', STRESSED: 'stressed', TILTED: 'tilting',
};

/** Two-line sparkline (focus + stress β) with kill/death markers, in the brand look. */
function FocusChart({ timeline, events }: { timeline: FocusReading[]; events: MatchEvent[] }) {
  const W = 300;
  const H = 90;
  if (timeline.length < 2) {
    return <div style={{ height: H, display: 'flex', alignItems: 'center', color: t.color.textFaint, fontSize: t.font.sm }}>Collecting signal…</div>;
  }
  const t0 = timeline[0]!.t;
  const t1 = timeline[timeline.length - 1]!.t;
  const span = Math.max(1, t1 - t0);
  const x = (tt: number) => ((tt - t0) / span) * W;
  const y = (score: number) => H - (score / 100) * H;
  const line = (pick: (r: FocusReading) => number) =>
    timeline.map((r) => `${x(r.t).toFixed(1)},${y(pick(r)).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
      style={{ background: t.brand.canvas, borderRadius: t.radius.md, display: 'block' }}>
      <polyline points={line((r) => r.stressScore)} fill="none" stroke={t.brand.stress} strokeWidth="1.5" opacity="0.9" />
      <polyline points={line((r) => r.focusScore)} fill="none" stroke={t.brand.focus} strokeWidth="2" />
      {events.map((e, i) => {
        const cx = x(e.t);
        if (cx < 0 || cx > W) return null;
        return <circle key={i} cx={cx} cy={e.kind === 'death' ? H - 6 : 6} r="3"
          fill={e.kind === 'death' ? t.brand.death : t.brand.kill} />;
      })}
    </svg>
  );
}

function Legend() {
  const item = (color: string, label: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: t.font.sm, color: t.color.textMuted }}>
      <span style={{ width: 9, height: 3, background: color, borderRadius: 2, display: 'inline-block' }} />{label}
    </span>
  );
  const dot = (color: string, label: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: t.font.sm, color: t.color.textMuted }}>
      <span style={{ width: 7, height: 7, background: color, borderRadius: '50%', display: 'inline-block' }} />{label}
    </span>
  );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.space.md }}>
      {item(t.brand.focus, 'Focus')}{item(t.brand.stress, 'Stress β')}
      {dot(t.brand.kill, 'Kill')}{dot(t.brand.death, 'Death')}
    </div>
  );
}

export function FocusPanel({ session }: { session: FocusSession }) {
  const { mode, status, deviceName, connect, disconnect, setMode, reading, live, timeline, events, recording } = session;

  // Chart the deliberate recording once it exists; until then show the live rolling
  // window so the panel is never blank while a headset streams.
  const chart = timeline.length > 1 ? timeline : live;
  const crash = useMemo(() => findCrash(timeline, events), [timeline, events]);
  const tiltMax = 5;

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: t.space.sm }}>
      <SectionLabel tone="ai">Focus · session</SectionLabel>
      {recording && <span style={{ fontSize: t.font.xs, color: t.brand.death }}>● REC</span>}
      {deviceName && <span style={{ fontSize: t.font.xs, color: t.color.textFaint }}>{deviceName}</span>}
      {mode !== 'off' && (
        <button type="button" onClick={() => void disconnect()} style={{ ...btn('ghost'), marginLeft: 'auto' }}>Disconnect</button>
      )}
    </div>
  );

  // Off state — first-time connect / demo.
  if (mode === 'off') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.md }}>
        <SectionLabel tone="ai">Focus · mental game</SectionLabel>
        <div style={{ fontSize: t.font.base, color: t.color.textMuted, lineHeight: t.line.normal }}>
          Track focus &amp; stress from your NeuroFocus headset, time-aligned to the match. A coarse,
          per-session proxy — not mind-reading.
        </div>
        <div style={{ display: 'flex', gap: t.space.sm, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void connect()} style={btn('primary')}>Connect headset</button>
          <button type="button" onClick={() => setMode('demo')} style={btn('ghost')}>Try demo</button>
        </div>
      </div>
    );
  }

  const focusScore = reading?.focusScore ?? null;
  const stateLabel = reading ? STATE_LABEL[reading.state] ?? '' : '';
  const badQuality = reading != null && reading.quality <= 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.md }}>
      {header}

      {status === 'connecting' && <div style={{ color: t.color.accentText, fontSize: t.font.base }}>Connecting to headset…</div>}
      {status === 'error' && <div style={{ color: t.brand.death, fontSize: t.font.base }}>Couldn’t connect — is the headset on &amp; in range?</div>}

      {/* Hero number */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: t.space.md }}>
        <span style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, color: t.brand.ink, letterSpacing: -1 }}>
          {focusScore ?? '—'}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: t.font.sm, textTransform: 'uppercase', letterSpacing: 0.6, color: t.color.textMuted }}>Focus</span>
          {reading && reading.state !== 'UNKNOWN' && reading.state !== 'CALIBRATING' && (
            <span style={{ fontSize: t.font.base, color: reading.tilt >= 3 ? t.brand.stress : t.color.textMuted }}>
              tilt {reading.tilt} / {tiltMax}
            </span>
          )}
          {stateLabel && <span style={{ fontSize: t.font.sm, color: t.color.textFaint }}>{stateLabel}</span>}
        </div>
      </div>

      {badQuality && (
        <div style={{ fontSize: t.font.sm, color: t.brand.stress }}>Adjust the headset for better contact — signal is noisy.</div>
      )}

      <FocusChart timeline={chart} events={events} />
      <Legend />

      {crash && (
        <div style={{ fontSize: t.font.base, color: t.color.text, lineHeight: t.line.normal }}>
          You crashed after a death at <strong>{formatClock(crash.deathAt)}</strong> — focus fell{' '}
          <strong style={{ color: t.brand.focus }}>{crash.from} → {crash.to}</strong> and didn’t recover.
        </div>
      )}

      {mode === 'demo' && (
        <div style={{ fontSize: t.font.xs, color: t.color.textFaint }}>
          Demo signal — connect a headset for your real focus.
        </div>
      )}
    </div>
  );
}
