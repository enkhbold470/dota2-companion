export interface RoshanInput { killedAtClock: number | null }

export interface RoshanConfig { minSeconds: number; maxSeconds: number }
export const DEFAULT_ROSHAN: RoshanConfig = { minSeconds: 480, maxSeconds: 660 };

export interface RoshanTimer {
  status: 'unknown' | 'dead';
  minRespawn: number | null;
  maxRespawn: number | null;
  secondsToMin: number | null;
  secondsToMax: number | null;
}

export function roshanTimer(
  input: RoshanInput,
  clock: number,
  cfg: RoshanConfig = DEFAULT_ROSHAN,
): RoshanTimer {
  if (input.killedAtClock === null) {
    return { status: 'unknown', minRespawn: null, maxRespawn: null, secondsToMin: null, secondsToMax: null };
  }
  const minRespawn = input.killedAtClock + cfg.minSeconds;
  const maxRespawn = input.killedAtClock + cfg.maxSeconds;
  return {
    status: 'dead',
    minRespawn,
    maxRespawn,
    secondsToMin: minRespawn - clock,
    secondsToMax: maxRespawn - clock,
  };
}
