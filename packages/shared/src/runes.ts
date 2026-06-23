export type RuneType = 'bounty' | 'power' | 'water';

export interface RuneSchedule {
  bounty: { start: number; interval: number };
  power: { start: number; interval: number };
  water: number[]; // fixed one-off spawn times
}

export const DEFAULT_RUNE_SCHEDULE: RuneSchedule = {
  bounty: { start: 0, interval: 180 },
  power: { start: 360, interval: 120 },
  water: [120, 240],
};

export interface RuneTimer {
  type: RuneType;
  nextSpawn: number;
  /** 0 means spawning now; entry is absent once past. */
  secondsUntil: number;
}

function nextPeriodic(clock: number, start: number, interval: number): number {
  if (clock <= start) return start;
  const k = Math.ceil((clock - start) / interval);
  return start + k * interval;
}

export function runeTimers(
  clock: number,
  schedule: RuneSchedule = DEFAULT_RUNE_SCHEDULE,
): RuneTimer[] {
  const out: RuneTimer[] = [];

  const bounty = nextPeriodic(clock, schedule.bounty.start, schedule.bounty.interval);
  out.push({ type: 'bounty', nextSpawn: bounty, secondsUntil: bounty - clock });

  const power = nextPeriodic(clock, schedule.power.start, schedule.power.interval);
  out.push({ type: 'power', nextSpawn: power, secondsUntil: power - clock });

  const nextWater = [...schedule.water].sort((a, b) => a - b).find((t) => t >= clock);
  if (nextWater !== undefined) {
    out.push({ type: 'water', nextSpawn: nextWater, secondsUntil: nextWater - clock });
  }

  return out;
}
