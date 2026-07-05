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

export interface NormalizedState {
  matchId: string | null;
  inProgress: boolean;
  paused: boolean;
  clock: number | null;
  isDay: boolean | null;
  hero: {
    id: number | null;
    level: number | null;
    alive: boolean | null;
    respawnSeconds: number | null;
    hasScepter: boolean;
    hasShard: boolean;
  };
  economy: {
    gold: number | null;
    netWorth: number | null;
    gpm: number | null;
    xpm: number | null;
    lastHits: number | null;
  };
  items: string[];           // names in item slots 0..8, excluding empty slots
  hasTp: boolean;            // TP scroll present in the teleport slot
  abilities: NormalizedAbility[]; // real hero abilities in slot order (cosmetic/talent slots filtered)
}

export const GAME_IN_PROGRESS = 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS';
export const EMPTY_ITEM = 'empty';
export const DAY_NIGHT_PHASE = 300; // seconds per day or night phase
