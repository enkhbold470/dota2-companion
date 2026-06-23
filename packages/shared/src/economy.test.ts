import { describe, it, expect } from 'vitest';
import { gradeEconomy } from './economy';

describe('gradeEconomy', () => {
  it('grades a core ahead / on-track / behind', () => {
    expect(gradeEconomy(600, 'core')).toMatchObject({ target: 500, delta: 100, rating: 'ahead' });
    expect(gradeEconomy(520, 'core')).toMatchObject({ rating: 'on-track' });
    expect(gradeEconomy(400, 'core')).toMatchObject({ rating: 'behind' });
  });
  it('uses a lower target for supports', () => {
    expect(gradeEconomy(360, 'support')).toMatchObject({ target: 300, rating: 'ahead' });
  });
  it('returns unknown when gpm or role is unknown', () => {
    expect(gradeEconomy(null, 'core')).toMatchObject({ rating: 'unknown', delta: null });
    expect(gradeEconomy(500, 'unknown')).toMatchObject({ rating: 'unknown' });
  });
});
