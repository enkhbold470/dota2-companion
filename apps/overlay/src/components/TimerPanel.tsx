import { formatClock, type RuneTimer, type RoshanTimer } from '@dc/shared';

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
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6 }}>
      <div><strong>Clock:</strong> {clock === null ? '—' : formatClock(clock)}</div>
      <div>
        <strong>{dayNightLabel}</strong>
        {secondsToTransition !== null && <span> · flips in {formatClock(secondsToTransition)}</span>}
      </div>
      {runes.map((r) => (
        <div key={r.type}>{r.type} rune in {formatClock(r.secondsUntil)}</div>
      ))}
      <div>
        Roshan:{' '}
        {roshan.status === 'unknown'
          ? 'alive / unknown'
          : `back in ${formatClock(roshan.secondsToMin ?? 0)}–${formatClock(roshan.secondsToMax ?? 0)}`}
        <button onClick={onRoshanDown} style={{ marginLeft: 6, fontSize: 10 }}>Rosh down</button>
      </div>
    </div>
  );
}
