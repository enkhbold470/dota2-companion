import type {
  AbilityData,
  AbilityDataMap,
  HeroDataMap,
  ThreatFlag,
  ThreatKind,
  ThreatReport,
} from './coaching-types';

const HARD_DISABLE_KEY =
  /(hex|voodoo|stun|impale|bash|torrent|chronosphere|black_hole|reverse_polarity|ravage|epicenter|fissure|hoof_stomp|dream_coil|primal_roar|_roar$|petrif|freeze|shackle|ensnare|snare|net$|lasso|abduct|toss|swap|gaze|cyclone|vacuum|imprison|root)/;
const SILENCE_KEY = /(silence|ancient_seal|last_word|gust$)/;
// riki_backstab is Cloak and Dagger — Riki's permanent invisibility.
const INVISIBILITY_KEY =
  /(wind_walk|windwalk|shadow_walk|skeleton_walk|vendetta|shadow_dance|ghost_walk|moonlight_shadow|meld|vanish|invis|riki_backstab)/;
const EVASION_KEY = /(blur|evasion|drunken|windrun)/;
const ILLUSIONS_KEY =
  /(conjure_image|mirror_image|doppelganger|phantasm|manta|juxtapose|wall_of_replica|haunt|reflection)/;
const SUMMONS_KEY =
  /(summon|call_of_the_wild|natures_call|spawn_spiderlings|demonic_conversion|familiar|serpent_ward|plague_ward|tombstone|eidolon)/;
const SUSTAIN_KEY =
  /(heal(?!th)|regen|feast|leech|siphon|mend|shallow_grave|false_promise|purification|supernova|reincarnation|borrowed_time|time_lapse)/;

const DAMAGE_ATTRIB = /(damage|dmg)/;
const DAMAGE_ATTRIB_EXCLUDE = /(delay|reduction|amp)/;
const BURST_THRESHOLD = 150;

function hasBurstDamageAttrib(ability: AbilityData): boolean {
  for (const attrib of ability.attribs ?? []) {
    if (!DAMAGE_ATTRIB.test(attrib.key) || DAMAGE_ATTRIB_EXCLUDE.test(attrib.key)) continue;
    if (attrib.value.some((v) => v >= BURST_THRESHOLD)) return true;
  }
  return false;
}

function isHardDisable(key: string, ability: AbilityData): boolean {
  if (HARD_DISABLE_KEY.test(key)) return true;
  const hasDuration = (ability.attribs ?? []).some((a) => a.key.includes('duration'));
  const hardToRemove = ability.dispellable === 'Strong Dispels Only' || ability.dispellable === 'No';
  const unitTarget = (ability.behavior ?? []).includes('Unit Target');
  return hasDuration && hardToRemove && unitTarget;
}

function classifyAbility(key: string, ability: AbilityData): ThreatKind[] {
  const kinds: ThreatKind[] = [];
  if (ability.dmgType === 'Magical' && ability.bkbPierce !== 'Yes' && hasBurstDamageAttrib(ability)) {
    kinds.push('magical-burst');
  }
  if (ability.bkbPierce === 'Yes' && (ability.dmgType !== undefined || ability.dispellable !== undefined)) {
    kinds.push('pierces-bkb');
  }
  if (ability.dispellable === 'Yes') kinds.push('dispellable-debuff');
  if (ability.dispellable === 'Strong Dispels Only') kinds.push('strong-dispel-debuff');
  if (ability.dispellable === 'No') kinds.push('undispellable');
  if (isHardDisable(key, ability)) kinds.push('hard-disable');
  if (SILENCE_KEY.test(key)) kinds.push('silence');
  if (INVISIBILITY_KEY.test(key)) kinds.push('invisibility');
  if (EVASION_KEY.test(key)) kinds.push('evasion');
  if (ILLUSIONS_KEY.test(key)) kinds.push('illusions');
  if (SUMMONS_KEY.test(key)) kinds.push('summons');
  if (SUSTAIN_KEY.test(key)) kinds.push('sustain');
  return kinds;
}

export function buildThreatReport(
  enemyIds: number[],
  heroes: HeroDataMap,
  abilities: AbilityDataMap,
): ThreatReport {
  const enemies: ThreatReport['enemies'] = [];
  const flags: ThreatFlag[] = [];
  const counts: ThreatReport['counts'] = {};
  for (const heroId of enemyIds) {
    const hero = heroes[String(heroId)];
    if (!hero) continue;
    enemies.push({ heroId, heroName: hero.localizedName });
    for (const abilityKey of hero.abilities) {
      const ability = abilities[abilityKey];
      if (!ability) continue;
      for (const kind of classifyAbility(abilityKey, ability)) {
        flags.push({ kind, heroId, heroName: hero.localizedName, abilityName: ability.dname });
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
    }
  }
  return { enemies, flags, counts };
}
