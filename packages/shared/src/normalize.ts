import type { GsiPayload, NormalizedState } from './types';
import { GAME_IN_PROGRESS, EMPTY_ITEM } from './types';

const numOrNull = (v: number | undefined): number | null =>
  typeof v === 'number' ? v : null;

export function normalizeGsi(payload: GsiPayload): NormalizedState {
  const map = payload.map ?? {};
  const player = payload.player ?? {};
  const hero = payload.hero ?? {};
  const items = payload.items ?? {};

  const itemNames = Object.keys(items)
    .filter((k) => k.startsWith('slot'))
    .sort()                                   // slot0..slot8 in order
    .map((k) => items[k]?.name)
    .filter((n): n is string => !!n && n !== EMPTY_ITEM);

  return {
    matchId: map.matchid ?? null,
    inProgress: map.game_state === GAME_IN_PROGRESS,
    paused: map.paused === true,
    clock: numOrNull(map.clock_time),
    isDay: typeof map.daytime === 'boolean' ? map.daytime : null,
    hero: {
      id: numOrNull(hero.id),
      level: numOrNull(hero.level),
      alive: typeof hero.alive === 'boolean' ? hero.alive : null,
      respawnSeconds: numOrNull(hero.respawn_seconds),
      hasScepter: hero.has_aghanims_scepter === true,
      hasShard: hero.has_aghanims_shard === true,
    },
    economy: {
      gold: numOrNull(player.gold),
      netWorth: numOrNull(player.net_worth),
      gpm: numOrNull(player.gpm),
      xpm: numOrNull(player.xpm),
      lastHits: numOrNull(player.last_hits),
    },
    items: itemNames,
  };
}
