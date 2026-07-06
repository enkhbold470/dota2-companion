import { formatClock, type RuneTimer, type RoshanTimer } from '@dc/shared';
import { t, btn, pill } from '../theme';

export interface TimerPanelProps {
  clock: number | null;
  dayNightLabel: string;
  secondsToTransition: number | null;
  runes: RuneTimer[];
  roshan: RoshanTimer;
  onRoshanDown: () => void;
}

export function TimerPanel(props: TimerPanelProps) {
  const { clock, dayNightLabel, secondsToTransition, runes, roshan, onRoshanDown } = props;
  const isNight = dayNightLabel.toUpperCase() === 'NIGHT';
  const dnColor = dayNightLabel === '—' ? t.color.textMuted : isNight ? t.color.accent : t.color.warn;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.sm }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: t.space.md }}>
        <span style={{ fontSize: t.font.xl, fontWeight: t.weight.semibold, fontVariantNumeric: 'tabular-nums' }}>
          {clock === null ? '—' : formatClock(clock)}
        </span>
        <span style={{ ...pill(dnColor), fontSize: t.font.xs, letterSpacing: 0.6 }}>{dayNightLabel}</span>
        {secondsToTransition !== null && (
          <span style={{ fontSize: t.font.sm, color: t.color.textFaint }}>flips in {formatClock(secondsToTransition)}</span>
        )}
      </div>

      {runes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.space.xs, fontSize: t.font.sm }}>
          {runes.map((r) => (
            <span key={r.type} style={pill(t.color.textMuted)}>
              {r.type} · {formatClock(r.secondsUntil)}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: t.space.sm, fontSize: t.font.base }}>
        <span style={{ color: t.color.textMuted }}>Roshan</span>
        <span style={{ color: t.color.text }}>
          {roshan.status === 'unknown'
            ? 'alive / unknown'
            : `back in ${formatClock(roshan.secondsToMin ?? 0)}–${formatClock(roshan.secondsToMax ?? 0)}`}
        </span>
        <button type="button" onClick={onRoshanDown} style={{ ...btn('ghost'), marginLeft: 'auto' }}>Rosh down</button>
      </div>
    </div>
  );
}
