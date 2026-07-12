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
