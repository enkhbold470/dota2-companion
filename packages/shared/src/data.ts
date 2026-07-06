import type { AbilityDataMap, HeroDataMap, ItemDataMap } from './coaching-types';
import heroDataJson from './data/hero-data.json';
import abilityDataJson from './data/ability-data.json';
import itemDataJson from './data/item-data.json';

export const HERO_DATA = heroDataJson as HeroDataMap;
export const ABILITY_DATA = abilityDataJson as AbilityDataMap;
export const ITEM_DATA = itemDataJson as ItemDataMap;

export function heroById(id: number | null): HeroDataMap[string] | null {
  if (id === null) return null;
  return HERO_DATA[String(id)] ?? null;
}
