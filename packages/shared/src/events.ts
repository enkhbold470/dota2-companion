/**
 * Derive discrete match events from successive GSI snapshots — pure and testable.
 *
 * The overlay feeds each new NormalizedState in with the previous one; we diff them
 * and emit the moments a player cares about (kills, deaths, respawns, level-ups,
 * day/night, and — via a sharp HP drop — being in a fight). These are time-tagged to
 * the match clock and overlaid on the focus/stress timeline so you can see, e.g.,
 * "stress spiked, then focus fell after this death".
 *
 * Only Valve GSI is used. "battle" is a proxy (took significant damage this tick),
 * never a claim of a formally-detected teamfight.
 */
import type { NormalizedState } from './types';
import type { GameEventKind, MatchEvent } from './eeg';

export type { GameEventKind, MatchEvent };

/** A single-tick HP drop (in percentage points) large enough to call "in a fight". */
export const BATTLE_HP_DROP = 12;

/** Human labels + display ordering for the timeline legend. */
export const EVENT_KINDS: GameEventKind[] = [
  'game_start', 'battle', 'kill', 'death', 'assist', 'respawn', 'level_up', 'day', 'night', 'game_end',
];

export const EVENT_LABEL: Record<GameEventKind, string> = {
  game_start: 'Game start', game_end: 'Game end',
  kill: 'Kill', death: 'Death', assist: 'Assist',
  respawn: 'Respawn', level_up: 'Level up',
  battle: 'Battle', day: 'Day', night: 'Night',
};

/**
 * Events that occurred between `prev` and `next`. Returns [] when there's no prior
 * snapshot (nothing to diff) or nothing changed. Pass null for `prev` on the first
 * snapshot of a session/match so no phantom start/kill events fire.
 */
export function deriveEvents(prev: NormalizedState | null, next: NormalizedState): MatchEvent[] {
  if (!prev) return [];
  const t = next.clock ?? 0;
  const out: MatchEvent[] = [];

  if (!prev.inProgress && next.inProgress) out.push({ t, kind: 'game_start' });
  if (prev.inProgress && !next.inProgress) out.push({ t, kind: 'game_end' });

  const up = (a: number | null, b: number | null): boolean =>
    typeof a === 'number' && typeof b === 'number' && b > a;

  if (up(prev.combat.kills, next.combat.kills)) out.push({ t, kind: 'kill' });
  if (up(prev.combat.deaths, next.combat.deaths)) out.push({ t, kind: 'death' });
  if (up(prev.combat.assists, next.combat.assists)) out.push({ t, kind: 'assist' });

  if (up(prev.hero.level, next.hero.level)) out.push({ t, kind: 'level_up', value: next.hero.level ?? undefined });

  // Respawn: was dead, now alive.
  if (prev.hero.alive === false && next.hero.alive === true) out.push({ t, kind: 'respawn' });

  // Day/night flip.
  if (typeof prev.isDay === 'boolean' && typeof next.isDay === 'boolean' && prev.isDay !== next.isDay) {
    out.push({ t, kind: next.isDay ? 'day' : 'night' });
  }

  // Battle proxy: a sharp HP drop while alive = took damage in a fight.
  const hpPrev = prev.hero.hpPercent;
  const hpNext = next.hero.hpPercent;
  if (typeof hpPrev === 'number' && typeof hpNext === 'number'
      && next.hero.alive !== false && hpPrev - hpNext >= BATTLE_HP_DROP) {
    out.push({ t, kind: 'battle', value: hpNext });
  }

  return out;
}
