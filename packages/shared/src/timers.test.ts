import { describe, it, expect } from 'vitest';
import { dayNight } from './timers';

describe('dayNight', () => {
  it('is day at the horn, night comes at 5:00', () => {
    expect(dayNight(0)).toEqual({ isDay: true, secondsToNextTransition: 300 });
    expect(dayNight(299)).toEqual({ isDay: true, secondsToNextTransition: 1 });
  });
  it('flips to night at 300s and back to day at 600s', () => {
    expect(dayNight(300)).toEqual({ isDay: false, secondsToNextTransition: 300 });
    expect(dayNight(450)).toEqual({ isDay: false, secondsToNextTransition: 150 });
    expect(dayNight(600)).toEqual({ isDay: true, secondsToNextTransition: 300 });
  });
  it('treats pre-horn (negative clock) as day', () => {
    expect(dayNight(-30)).toEqual({ isDay: true, secondsToNextTransition: 330 });
  });
});
