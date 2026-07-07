import type { HeroDataMap } from './coaching-types';
import type { Team } from './types';

// Fold names to a comparable core: lowercase, strip spaces/punctuation. Makes
// "Anti-Mage", "anti mage" and "antimage" all collide onto the same key, which
// is what we want when a vision model spells a hero slightly off.
const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Resolve free-text hero names (e.g. from a screenshot) to numeric hero ids,
 * de-duplicated and capped. Unknown names are skipped rather than guessed.
 */
export function matchHeroNames(names: string[], heroes: HeroDataMap, max = 5): number[] {
  const byName = new Map<string, number>();
  for (const [id, hero] of Object.entries(heroes)) {
    byName.set(normalize(hero.localizedName), Number(id));
  }

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const name of names) {
    if (typeof name !== 'string') continue;
    const id = byName.get(normalize(name));
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= max) break;
  }
  return ids;
}

/** A draft read from the screen: hero names per side (as the vision model saw them). */
export interface DraftSides { radiant: string[]; dire: string[] }

/**
 * Split a screen-read draft into our allies and the enemies, given which side we
 * are (from GSI `player.team_name`). Our own hero is dropped from allies. When
 * `team` is null (unknown side) we can't tell allies from enemies, so both are
 * empty and the caller falls back to the manual picker.
 */
export function splitDraftByTeam(
  team: Team | null,
  draft: DraftSides,
  ownHeroId: number | null,
  heroes: HeroDataMap,
): { enemies: number[]; allies: number[] } {
  if (team !== 'radiant' && team !== 'dire') return { enemies: [], allies: [] };
  const ourNames = team === 'radiant' ? draft.radiant : draft.dire;
  const theirNames = team === 'radiant' ? draft.dire : draft.radiant;
  const allies = matchHeroNames(ourNames, heroes).filter((id) => id !== ownHeroId);
  const enemies = matchHeroNames(theirNames, heroes);
  return { enemies, allies };
}
