// ---- Raw GSI payload (only the fields we consume) ----
export interface GsiAuth { token?: string }

export interface GsiMap {
  name?: string;
  matchid?: string;
  game_time?: number;
  clock_time?: number;        // game clock in seconds; negative before the horn
  daytime?: boolean;
  game_state?: string;        // e.g. "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"
  paused?: boolean;
}

export interface GsiPlayer {
  steamid?: string;
  name?: string;
  team_name?: string;         // "radiant" | "dire" — our side while playing
  gold?: number;
  net_worth?: number;
  gpm?: number;
  xpm?: number;
  last_hits?: number;
  denies?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
}

export interface GsiHero {
  id?: number;
  name?: string;
  level?: number;
  alive?: boolean;
  respawn_seconds?: number;
  health_percent?: number;
  mana_percent?: number;
  has_aghanims_scepter?: boolean;
  has_aghanims_shard?: boolean;
}

export interface GsiItem { name: string; charges?: number }

export interface GsiAbility {
  name?: string;
  level?: number;
  can_cast?: boolean;
  passive?: boolean;
  ability_active?: boolean;
  cooldown?: number;
  ultimate?: boolean;
}

export interface GsiPayload {
  auth?: GsiAuth;
  map?: GsiMap;
  player?: GsiPlayer;
  hero?: GsiHero;
  abilities?: Record<string, GsiAbility>;
  items?: Record<string, GsiItem>;
}

// ---- Normalized state the listener broadcasts and the UI consumes ----
export type Role = 'core' | 'support' | 'unknown';

export interface NormalizedAbility {
  name: string;
  level: number;
  canCast: boolean | null;
  cooldown: number | null;
  passive: boolean;
  ultimate: boolean;
}

/** Coarse match phase derived from the raw GSI game_state string. */
export type GamePhase =
  | 'loading'         // init / waiting for players / map load
  | 'hero_selection'  // drafting
  | 'strategy'        // picks locked, strategy time — top hero bar is populated
  | 'pre_game'        // horn countdown
  | 'in_progress'     // GAME_IN_PROGRESS
  | 'post_game'       // match over
  | 'unknown';        // no/unrecognized game_state

export type Team = 'radiant' | 'dire';

export interface NormalizedState {
  matchId: string | null;
  inProgress: boolean;
  /** Raw GSI game_state, e.g. "DOTA_GAMERULES_STATE_STRATEGY_TIME" (null pre-connect). */
  gameState: string | null;
  /** Coarse phase derived from gameState — times the auto draft scan. */
  phase: GamePhase;
  /** Our side, from player.team_name — which drafted team is "us". */
  team: Team | null;
  /** Raw 64-bit Steam id string from GSI (null pre-connect / spectating oddities). */
  steamId: string | null;
  paused: boolean;
  clock: number | null;
  isDay: boolean | null;
  hero: {
    id: number | null;
    level: number | null;
    alive: boolean | null;
    respawnSeconds: number | null;
    hpPercent: number | null;   // 0..100; drives "battle" (damage-taken) detection
    mpPercent: number | null;   // 0..100
    hasScepter: boolean;
    hasShard: boolean;
  };
  economy: {
    gold: number | null;
    netWorth: number | null;
    gpm: number | null;
    xpm: number | null;
    lastHits: number | null;
    denies: number | null;
  };
  combat: {                  // used by the biometric layer to mark kill/death events
    kills: number | null;
    deaths: number | null;
    assists: number | null;
  };
  items: string[];           // names in item slots 0..8, excluding empty slots
  hasTp: boolean;            // TP scroll present in the teleport slot
  abilities: NormalizedAbility[]; // real hero abilities in slot order (cosmetic/talent slots filtered)
}

export const GAME_IN_PROGRESS = 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS';
export const EMPTY_ITEM = 'empty';
export const DAY_NIGHT_PHASE = 300; // seconds per day or night phase
