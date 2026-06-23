import { DAY_NIGHT_PHASE } from './types';

export interface DayNightInfo {
  isDay: boolean;
  secondsToNextTransition: number;
}

export function dayNight(clock: number): DayNightInfo {
  if (clock < 0) {
    // Pre-horn: it is day; first night is at clock === DAY_NIGHT_PHASE.
    return { isDay: true, secondsToNextTransition: DAY_NIGHT_PHASE - clock };
  }
  const into = clock % DAY_NIGHT_PHASE;
  const cycle = Math.floor(clock / DAY_NIGHT_PHASE);
  return {
    isDay: cycle % 2 === 0,
    secondsToNextTransition: DAY_NIGHT_PHASE - into,
  };
}
