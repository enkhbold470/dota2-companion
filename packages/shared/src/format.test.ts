import { describe, it, expect } from 'vitest';
import { formatClock } from './format';

describe('formatClock', () => {
  it('formats m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(600)).toBe('10:00');
  });
  it('formats negative values with a leading minus', () => {
    expect(formatClock(-30)).toBe('-0:30');
    expect(formatClock(-95)).toBe('-1:35');
  });
  it('rounds sub-second negative values to 0:00 without a minus sign', () => {
    expect(formatClock(-0.9)).toBe('0:00');
  });
});
