import type { ItemDataMap } from './coaching-types';

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Resolve free-text item names (e.g. from the LLM) to dotaconstants item keys so
 * we can show the right icon and cost. Matches on display name first, then the
 * raw key. Unknown names resolve to null — the caller still shows the text.
 */
export function matchItemKeys(names: string[], items: ItemDataMap): (string | null)[] {
  const byName = new Map<string, string>();
  // Display names win: "Aghanim's Scepter" must resolve to ultimate_scepter, not
  // to the ultimate_scepter_2 key ("Aghanim's Blessing"), which normalizes to the
  // same string. So set all dnames first, then only add key aliases where free.
  for (const [key, data] of Object.entries(items)) {
    const n = normalize(data.dname);
    if (!byName.has(n)) byName.set(n, key);
  }
  for (const key of Object.keys(items)) {
    const n = normalize(key);
    if (!byName.has(n)) byName.set(n, key);
  }
  return names.map((name) => (typeof name === 'string' ? byName.get(normalize(name)) ?? null : null));
}
