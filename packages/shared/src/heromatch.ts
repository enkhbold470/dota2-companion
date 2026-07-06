import type { HeroDataMap } from './coaching-types';

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
