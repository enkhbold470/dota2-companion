import type { AbilityDataMap, SkillReadout } from './coaching-types';
import type { NormalizedAbility } from './types';

/** Attrib-key fragments that disqualify an attrib from being the primary damage number. */
const EXCLUDED_FRAGMENTS = ['delay', 'duration', 'interval', 'reduction', 'amp', 'threshold', 'share', 'return'];

function isExcludedKey(key: string): boolean {
  return EXCLUDED_FRAGMENTS.some((fragment) => key.includes(fragment));
}

/**
 * Pick the attrib holding the ability's primary damage numbers.
 * Priority: exact 'damage', then '*_damage' suffix, then any key containing
 * 'damage' or 'dmg' — always skipping excluded keys (delays, durations, etc.).
 */
function pickDamageAttrib(
  attribs: { key: string; header: string; value: number[] }[] | undefined,
): { key: string; header: string; value: number[] } | null {
  if (!attribs) return null;
  const candidates = attribs.filter((attrib) => !isExcludedKey(attrib.key));
  return (
    candidates.find((attrib) => attrib.key === 'damage') ??
    candidates.find((attrib) => attrib.key.endsWith('_damage')) ??
    candidates.find((attrib) => attrib.key.includes('damage') || attrib.key.includes('dmg')) ??
    null
  );
}

/**
 * Value of a per-level array at the current level.
 * Level 0 (unlearned) is null; single-element arrays broadcast to every level.
 */
function valueAtLevel(arr: number[] | undefined, level: number): number | null {
  if (!arr || arr.length === 0 || level <= 0) return null;
  return arr[Math.min(level, arr.length) - 1] ?? null;
}

/**
 * Value one level ahead ("what one more point buys").
 * At level 0 this is the level-1 value; null once level >= arr.length.
 */
function nextValueAtLevel(arr: number[] | undefined, level: number): number | null {
  if (!arr || level >= arr.length) return null;
  return arr[level] ?? null;
}

export function buildSkillReadout(abilities: NormalizedAbility[], data: AbilityDataMap): SkillReadout[] {
  return abilities.map((ability) => {
    const key = ability.name;
    const fallbackMaxLevel = ability.ultimate ? 3 : 4;
    const base = {
      key,
      level: ability.level,
      remainingCooldown: ability.cooldown,
      canCast: ability.canCast,
      ultimate: ability.ultimate,
      passive: ability.passive,
    };

    const entry = data[key];
    if (!entry) {
      return {
        ...base,
        name: key,
        maxLevel: fallbackMaxLevel,
        damage: null,
        damageNext: null,
        dmgType: null,
        cooldown: null,
        manaCost: null,
      };
    }

    const damageAttrib = pickDamageAttrib(entry.attribs);
    const longest = Math.max(entry.cd?.length ?? 0, entry.mc?.length ?? 0, damageAttrib?.value.length ?? 0);
    return {
      ...base,
      name: entry.dname ?? key,
      maxLevel: longest > 1 ? longest : fallbackMaxLevel,
      damage: valueAtLevel(damageAttrib?.value, ability.level),
      damageNext: nextValueAtLevel(damageAttrib?.value, ability.level),
      dmgType: entry.dmgType ?? null,
      cooldown: valueAtLevel(entry.cd, ability.level),
      manaCost: valueAtLevel(entry.mc, ability.level),
    };
  });
}
