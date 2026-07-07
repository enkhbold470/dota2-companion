import type { HeroDataMap } from './coaching-types';
import type { Team } from './types';

// Fold names to a comparable core: lowercase, strip spaces/punctuation. Makes
// "Anti-Mage", "anti mage" and "antimage" all collide onto the same key, which
// is what we want when a vision model spells a hero slightly off.
const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Renames and community names the vision model emits that neither the
// localizedName nor the npc_dota_hero_* internal name covers. Keys are
// normalized alias → normalized localizedName present in hero-data.json.
// (dotaconstants still ships the pre-rename "Outworld Devourer", while the
// model reads the current in-game "Outworld Destroyer" off the screen.)
const HERO_ALIASES: Record<string, string> = {
  outworlddestroyer: 'outworlddevourer',
  od: 'outworlddevourer',
  outhouse: 'outworlddevourer',
  windrunner: 'windranger',
  skeletonking: 'wraithking',
  necrolyte: 'necrophos',
  zuus: 'zeus',
  wisp: 'io',
  furion: 'naturesprophet',
  clockwork: 'clockwerk',
  doombringer: 'doom',
  magnataur: 'magnus',
  naix: 'lifestealer',
  nevermore: 'shadowfiend',
  shredder: 'timbersaw',
  treant: 'treantprotector',
  pitlord: 'underlord',
  aboveallwatcher: 'underlord',
  queenofpainqop: 'queenofpain',
  qop: 'queenofpain',
  am: 'antimage',
};

/** Single-edit distance check (insert/delete/replace/transpose ≤ `max`). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      rowMin = Math.min(rowMin, curr[j] ?? 0);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? max + 1;
}

interface HeroLookup {
  exact: Map<string, number>;
  keys: string[]; // exact-map keys, for the fuzzy pass
}

function buildLookup(heroes: HeroDataMap): HeroLookup {
  const exact = new Map<string, number>();
  const put = (key: string, id: number): void => {
    if (key !== '' && !exact.has(key)) exact.set(key, id);
  };
  for (const [idStr, hero] of Object.entries(heroes)) {
    const id = Number(idStr);
    put(normalize(hero.localizedName), id);
    // Internal names carry legacy spellings for free: npc_dota_hero_furion,
    // _zuus, _windrunner, _obsidian_destroyer, _magnataur, _wisp, …
    put(normalize(hero.name.replace(/^npc_dota_hero_/, '')), id);
  }
  for (const [alias, canonical] of Object.entries(HERO_ALIASES)) {
    const id = exact.get(canonical);
    if (id !== undefined) put(alias, id);
  }
  return { exact, keys: [...exact.keys()] };
}

/**
 * Fuzzy rescue for near-miss spellings: accept only a UNIQUE best candidate
 * within a small edit distance (2, or 1 for short names). Ambiguity → no match;
 * we never guess a hero.
 */
function fuzzyMatch(name: string, lookup: HeroLookup): number | undefined {
  const max = name.length < 8 ? 1 : 2;
  let bestId: number | undefined;
  let bestDist = max + 1;
  let tied = false;
  for (const key of lookup.keys) {
    const d = editDistance(name, key, max);
    if (d < bestDist) {
      bestDist = d;
      bestId = lookup.exact.get(key);
      tied = false;
    } else if (d === bestDist && bestDist <= max && lookup.exact.get(key) !== bestId) {
      tied = true;
    }
  }
  return bestDist <= max && !tied ? bestId : undefined;
}

/**
 * Resolve free-text hero names (e.g. from a screenshot) to numeric hero ids,
 * de-duplicated and capped. Exact (localized/internal/alias) match first, then
 * a conservative fuzzy pass. Unknown names are skipped rather than guessed.
 */
export function matchHeroNames(names: string[], heroes: HeroDataMap, max = 5): number[] {
  const lookup = buildLookup(heroes);
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const name of names) {
    if (typeof name !== 'string') continue;
    const key = normalize(name);
    const id = lookup.exact.get(key) ?? fuzzyMatch(key, lookup);
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
