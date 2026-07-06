import { type FocusReading } from '@dc/shared';
import { t, btn } from '../theme';
import type { FocusSession } from '../eeg/useFocusSession';

const STATE_LABEL: Record<string, string> = {
  UNKNOWN: 'no signal', CALIBRATING: 'calibrating', FOCUSED: 'in flow',
  FOCUS_DIP: 'focus dip', STRESSED: 'stressed', TILTED: 'tilting',
};

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** A slim rolling sparkline of the live focus score, with the brand glow. */
function LiveSpark({ live }: { live: FocusReading[] }) {
  const W = 132;
  const H = 34;
  if (live.length < 2) {
    return <div style={{ width: W, height: H }} />;
  }
  const x = (i: number) => (i / (live.length - 1)) * W;
  const y = (score: number) => H - (score / 100) * (H - 3) - 1.5;
  const pts = (pick: (r: FocusReading) => number) =>
    live.map((r, i) => `${x(i).toFixed(1)},${y(pick(r)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline points={pts((r) => r.stressScore)} fill="none" stroke={t.brand.stress} strokeWidth="1" opacity="0.7" />
      <polyline points={pts((r) => r.focusScore)} fill="none" stroke={t.brand.focus} strokeWidth="1.75"
        style={{ filter: t.brand.glowLine }} />
    </svg>
  );
}

/**
 * Always-on live focus readout, pinned to the top of the column. Streams the
 * current focus every second and carries the manual Start/Stop recording control —
 * the deliberate act that writes the raw EEG session to disk.
 */
export function LiveFocusStrip({ session }: { session: FocusSession }) {
  const {
    mode, reading, live, recording, recordStartedMs, sampleCount,
    startRecording, stopRecording, lastSave,
  } = session;

  if (mode === 'off') return null;

  const focus = reading?.focusScore ?? null;
  const state = reading?.state ?? 'UNKNOWN';
  const stateLabel = STATE_LABEL[state] ?? '';
  const tilt = reading?.tilt ?? 0;
  const elapsed = recording && recordStartedMs != null ? Math.floor((Date.now() - recordStartedMs) / 1000) : 0;
  const focusColor = state === 'TILTED' || state === 'STRESSED' ? t.brand.stress : t.brand.focus;

  return (
    <div style={{
      position: 'sticky', top: t.space.sm, zIndex: 20,
      display: 'flex', alignItems: 'center', gap: t.space.md,
      background: t.brand.canvas, border: `1px solid ${t.color.border}`,
      borderRadius: t.radius.lg, padding: `${t.space.sm}px ${t.space.md}px`,
      boxShadow: recording ? t.brand.glow : undefined,
    }}>
      {/* Live focus number */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: t.space.sm, minWidth: 78 }}>
        <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, letterSpacing: -0.5, color: focus == null ? t.color.textFaint : focusColor }}>
          {focus ?? '—'}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span style={{ fontSize: t.font.xs, textTransform: 'uppercase', letterSpacing: 0.5, color: t.color.textMuted }}>Focus</span>
          <span style={{ fontSize: t.font.xs, color: tilt >= 3 ? t.brand.stress : t.color.textFaint }}>
            {stateLabel}{tilt >= 3 ? ` · tilt ${tilt}` : ''}
          </span>
        </div>
      </div>

      <LiveSpark live={live} />

      {/* Record control */}
      <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        {recording ? (
          <button type="button" onClick={() => void stopRecording()}
            style={{ ...btn('ghost'), color: t.brand.death, borderColor: t.brand.death }}>
            ■ Stop &amp; save
          </button>
        ) : (
          <button type="button" onClick={startRecording} style={btn('primary')}>● Record</button>
        )}
        {recording && (
          <span style={{ fontSize: t.font.xs, color: t.brand.death }}>
            REC {mmss(elapsed)}{mode === 'device' ? ` · ${sampleCount.toLocaleString()} samples` : ''}
          </span>
        )}
        {!recording && lastSave?.ok && (
          <span style={{ fontSize: t.font.xs, color: t.color.success }} title={lastSave.file}>Saved ✓</span>
        )}
        {!recording && lastSave && !lastSave.ok && (
          <span style={{ fontSize: t.font.xs, color: t.brand.death }}>{lastSave.error}</span>
        )}
      </div>
    </div>
  );
}
