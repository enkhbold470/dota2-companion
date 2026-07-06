import type { AbilityDataMap, SkillReadout, SkillSuggestion } from './coaching-types';
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
// Attribs whose values never exceed this are fractions/multipliers
// (e.g. percent-of-HP damage), not displayable damage numbers.
const MIN_DAMAGE_VALUE = 5;

function pickDamageAttrib(
  attribs: { key: string; header: string; value: number[] }[] | undefined,
): { key: string; header: string; value: number[] } | null {
  if (!attribs) return null;
  const candidates = attribs.filter(
    (attrib) => !isExcludedKey(attrib.key) && attrib.value.some((v) => v >= MIN_DAMAGE_VALUE),
  );
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
        isInnate: false,
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
      isInnate: entry.isInnate === true,
    };
  });
}

/** Ultimate points unlock at hero levels 6/12/18. */
function allowedUltLevel(heroLevel: number | null): number {
  if (heroLevel === null) return 3; // unknown pre-connect — don't hold the ult back
  if (heroLevel >= 18) return 3;
  if (heroLevel >= 12) return 2;
  if (heroLevel >= 6) return 1;
  return 0;
}

/**
 * Suggest which ability to put the next point into — the "skill build" nudge.
 * Rule of thumb, in order: take the ultimate the moment it unlocks, otherwise
 * the biggest immediate damage spike, otherwise round out the build. Pure
 * function over the readout GSI already gives us — no per-hero build data.
 */
// A point-spendable ability: standard basics cap at 4, ultimates at 3. Anything
// else in the list (scepter/shard grants like Zeus's Nimbus, innate passives) is
// NOT leveled with skill points, so it must never be suggested.
function isSkillable(s: SkillReadout): boolean {
  if (s.isInnate) return false;
  const cap = s.ultimate ? 3 : 4;
  return s.maxLevel === cap && s.level < s.maxLevel;
}

export function suggestNextSkill(
  skills: SkillReadout[],
  heroLevel: number | null,
): SkillSuggestion | null {
  const levelable = skills.filter(isSkillable);
  if (levelable.length === 0) return null;

  const ult = levelable.find((s) => s.ultimate);
  if (ult && ult.level < allowedUltLevel(heroLevel)) {
    return { key: ult.key, name: ult.name, reason: 'Ultimate — take it the moment it unlocks' };
  }

  const bestDamage = levelable
    .filter((s) => !s.ultimate && s.damageNext !== null)
    .sort((a, b) => (b.damageNext ?? 0) - (a.damageNext ?? 0))[0];
  if (bestDamage) {
    return {
      key: bestDamage.key,
      name: bestDamage.name,
      reason: `Biggest damage spike (+${bestDamage.damageNext})`,
    };
  }

  // A non-ult basic with a value point still worth taking (no damage numbers).
  const valuePoint = levelable
    .filter((s) => !s.ultimate)
    .sort((a, b) => a.level - b.level)[0];
  if (valuePoint) {
    return { key: valuePoint.key, name: valuePoint.name, reason: 'Round out your build' };
  }

  // Only the ult is left but it can't be leveled yet — nothing to spend now.
  return null;
}
