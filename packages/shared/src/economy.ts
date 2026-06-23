import type { Role } from './types';

export interface EconomyGrade {
  gpm: number | null;
  target: number | null;
  delta: number | null;
  rating: 'ahead' | 'on-track' | 'behind' | 'unknown';
}

const TARGETS: Record<Exclude<Role, 'unknown'>, number> = { core: 500, support: 300 };

export function gradeEconomy(gpm: number | null, role: Role): EconomyGrade {
  if (gpm === null || role === 'unknown') {
    return { gpm, target: role === 'unknown' ? null : TARGETS[role], delta: null, rating: 'unknown' };
  }
  const target = TARGETS[role];
  const delta = gpm - target;
  let rating: EconomyGrade['rating'] = 'on-track';
  if (delta >= 50) rating = 'ahead';
  else if (delta <= -50) rating = 'behind';
  return { gpm, target, delta, rating };
}
