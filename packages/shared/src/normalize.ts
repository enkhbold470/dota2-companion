import type { GsiPayload, NormalizedState } from './types';
import { GAME_IN_PROGRESS, EMPTY_ITEM } from './types';

const numOrNull = (v: number | undefined): number | null =>
  typeof v === 'number' ? v : null;

// Cosmetic / talent pseudo-abilities that GSI reports alongside real skills.
const NON_SKILL_ABILITY = /^(special_bonus|plus_|seasonal_|abyssal_underlord_portal_warp$)/;

export function normalizeGsi(payload: GsiPayload): NormalizedState {
  const map = payload.map ?? {};
  const player = payload.player ?? {};
  const hero = payload.hero ?? {};
  const items = payload.items ?? {};
  const abilities = payload.abilities ?? {};

  const itemNames = Object.keys(items)
    .filter((k) => k.startsWith('slot'))
    .sort()                                   // slot0..slot8 in order
    .map((k) => items[k]?.name)
    .filter((n): n is string => !!n && n !== EMPTY_ITEM);

  const abilityList = Object.keys(abilities)
    .filter((k) => k.startsWith('ability'))
    .sort()                                   // ability0..ability9 in order
    .map((k) => abilities[k])
    .filter((a): a is NonNullable<typeof a> =>
      !!a?.name && a.name !== EMPTY_ITEM && !NON_SKILL_ABILITY.test(a.name))
    .map((a) => ({
      name: a.name as string,
      level: typeof a.level === 'number' ? a.level : 0,
      canCast: typeof a.can_cast === 'boolean' ? a.can_cast : null,
      cooldown: numOrNull(a.cooldown),
      passive: a.passive === true,
      ultimate: a.ultimate === true,
    }));

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
      hpPercent: numOrNull(hero.health_percent),
      mpPercent: numOrNull(hero.mana_percent),
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
    combat: {
      kills: numOrNull(player.kills),
      deaths: numOrNull(player.deaths),
      assists: numOrNull(player.assists),
    },
    items: itemNames,
    hasTp: !!items['teleport0']?.name && items['teleport0'].name !== EMPTY_ITEM,
    abilities: abilityList,
  };
}
