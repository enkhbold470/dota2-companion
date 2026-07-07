import type { GamePhase } from '@dc/shared';

export type AppMode = 'live' | 'studio';
export type ModeOverride = 'auto' | AppMode;

// Phases with a live game to coach. Everything else (post_game, unknown,
// no GSI at all) lands in NeuroFocus Studio — the between-games dashboard.
const LIVE_PHASES = new Set<GamePhase>(['loading', 'hero_selection', 'strategy', 'pre_game', 'in_progress']);

export function resolveMode(phase: GamePhase | null, override: ModeOverride): AppMode {
  if (override !== 'auto') return override;
  return phase !== null && LIVE_PHASES.has(phase) ? 'live' : 'studio';
}

/** Last match seen live via GSI — lets Studio show it after Dota closes. */
export interface LastMatchMemory { matchId: string; accountId: string; seenAtMs: number }

export const LAST_MATCH_KEY = 'nf.lastMatch';

export function readLastMatch(storage: Pick<Storage, 'getItem'>): LastMatchMemory | null {
  try {
    const raw = storage.getItem(LAST_MATCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastMatchMemory>;
    if (typeof parsed.matchId !== 'string' || typeof parsed.accountId !== 'string') return null;
    return { matchId: parsed.matchId, accountId: parsed.accountId, seenAtMs: parsed.seenAtMs ?? 0 };
  } catch {
    return null;
  }
}
