import { useMemo } from 'react';
import { findCrash, formatClock } from '@dc/shared';
import { t, btn, SectionLabel } from '../theme';
import { FocusTimeline } from './FocusTimeline';
import type { FocusSession } from '../eeg/useFocusSession';

const STATE_LABEL: Record<string, string> = {
  UNKNOWN: 'no signal', CALIBRATING: 'calibrating', FOCUSED: 'in flow',
  FOCUS_DIP: 'focus dip', STRESSED: 'stressed', TILTED: 'tilting',
};

export function FocusPanel({ session }: { session: FocusSession }) {
  const { mode, status, deviceName, connect, disconnect, setMode, reading, live, timeline, events, recording, samplesPerSec } = session;

  // Chart the deliberate recording once it exists; until then show the live rolling
  // window so the panel is never blank while a headset streams.
  const chart = timeline.length > 1 ? timeline : live;
  const crash = useMemo(() => findCrash(timeline, events), [timeline, events]);
  const tiltMax = 5;

  // Off state — first-time connect / demo.
  if (mode === 'off') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.md }}>
        <SectionLabel tone="ai">FlowState · mental game</SectionLabel>
        <div style={{ fontSize: t.font.base, color: t.color.textMuted, lineHeight: t.line.normal }}>
          Sync your FlowState — focus &amp; stress from your NeuroFocus headset — with your kills,
          deaths, respawns and fights. A coarse, per-session proxy — not mind-reading.
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
      <div style={{ display: 'flex', alignItems: 'center', gap: t.space.sm }}>
        <SectionLabel tone="ai">FlowState · session</SectionLabel>
        {recording && <span style={{ fontSize: t.font.xs, color: t.brand.death }}>● REC</span>}
        {deviceName && <span style={{ fontSize: t.font.xs, color: t.color.textFaint }}>{deviceName}</span>}
        {mode !== 'off' && (
          <button type="button" onClick={() => void disconnect()} style={{ ...btn('ghost'), marginLeft: 'auto' }}>Disconnect</button>
        )}
      </div>

      {status === 'connecting' && <div style={{ color: t.color.accentText, fontSize: t.font.base }}>Connecting to headset…</div>}
      {status === 'error' && <div style={{ color: t.brand.death, fontSize: t.font.base }}>Couldn’t connect — is the headset on &amp; in range?</div>}

      {/* Live BLE throughput — the fast way to tell "connected but not streaming". */}
      {mode === 'device' && (status === 'streaming' || samplesPerSec > 0) && (
        <div style={{ fontSize: t.font.sm, color: samplesPerSec > 0 ? t.color.success : t.brand.death }}>
          {samplesPerSec > 0
            ? `● streaming — ${samplesPerSec} samples/s`
            : '○ connected but no data — power-cycle the headset, or reconnect'}
        </div>
      )}

      {/* Hero number */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: t.space.md }}>
        <span style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, color: t.brand.ink, letterSpacing: -1 }}>
          {focusScore ?? '—'}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: t.font.sm, textTransform: 'uppercase', letterSpacing: 0.6, color: t.color.textMuted }}>FlowState</span>
          {reading && reading.state !== 'UNKNOWN' && reading.state !== 'CALIBRATING' && (
            <span style={{ fontSize: t.font.base, color: reading.tilt >= 3 ? t.brand.stress : t.color.textMuted }}>
              TiltGuard {reading.tilt} / {tiltMax}
            </span>
          )}
          {stateLabel && <span style={{ fontSize: t.font.sm, color: t.color.textFaint }}>{stateLabel}</span>}
        </div>
      </div>

      {badQuality && (
        <div style={{ fontSize: t.font.sm, color: t.brand.stress }}>Adjust the headset for better contact — signal is noisy.</div>
      )}

      <FocusTimeline timeline={chart} events={events} />

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
