import type {
  ItemData,
  ItemDataMap,
  ItemEngineInput,
  ItemRecommendation,
  ThreatFlag,
  ThreatKind,
  ThreatReport,
} from './coaching-types';
import type { Role } from './types';

interface Rule {
  itemKey: string;
  verb: string;
  trigger: (threat: ThreatReport, input: ItemEngineInput) => ThreatFlag[] | null;
  roles?: Role[];
  minClock?: number;
  weight: number;
}

const BKB_BLOCKED_KINDS: ThreatKind[] = ['magical-burst', 'hard-disable', 'strong-dispel-debuff'];

function flagsOf(threat: ThreatReport, kinds: ThreatKind[]): ThreatFlag[] {
  return threat.flags.filter((f) => kinds.includes(f.kind));
}

// One ability can emit several ThreatKinds (a stun that is also strong-dispel).
// Thresholds and scores must count distinct abilities, or a lone Sven's Storm
// Hammer would satisfy a "2+ threats" gate by itself.
function distinctAbilityCount(flags: ThreatFlag[]): number {
  return new Set(flags.map((f) => `${f.heroId}:${f.abilityName}`)).size;
}

function atLeast(flags: ThreatFlag[], min: number): ThreatFlag[] | null {
  return distinctAbilityCount(flags) >= min ? flags : null;
}

function bkbBlockableFlags(threat: ThreatReport): ThreatFlag[] {
  const pierces = new Set(
    threat.flags.filter((f) => f.kind === 'pierces-bkb').map((f) => `${f.heroId}:${f.abilityName}`),
  );
  return flagsOf(threat, BKB_BLOCKED_KINDS).filter((f) => !pierces.has(`${f.heroId}:${f.abilityName}`));
}

const RULES: Rule[] = [
  {
    itemKey: 'black_king_bar',
    verb: 'Blocks',
    trigger: (t) => atLeast(bkbBlockableFlags(t), 2),
    roles: ['core'],
    minClock: 900,
    weight: 30,
  },
  {
    itemKey: 'pipe',
    verb: 'Team barrier against',
    trigger: (t) => atLeast(flagsOf(t, ['magical-burst']), 2),
    minClock: 600,
    weight: 18,
  },
  {
    itemKey: 'glimmer_cape',
    verb: 'Saves allies from',
    trigger: (t) => atLeast(flagsOf(t, ['magical-burst']), 1),
    roles: ['support'],
    minClock: 300,
    weight: 16,
  },
  {
    itemKey: 'cyclone',
    verb: 'Counters',
    trigger: (t) => atLeast(flagsOf(t, ['silence', 'dispellable-debuff']), 1),
    minClock: 300,
    weight: 14,
  },
  {
    itemKey: 'manta',
    verb: 'Dispels',
    trigger: (t) => {
      const silences = flagsOf(t, ['silence']);
      const debuffs = flagsOf(t, ['dispellable-debuff']);
      if (silences.length >= 1 || debuffs.length >= 2) return [...silences, ...debuffs];
      return null;
    },
    roles: ['core'],
    minClock: 900,
    weight: 15,
  },
  {
    itemKey: 'lotus_orb',
    verb: 'Dispels',
    trigger: (t) => atLeast(flagsOf(t, ['dispellable-debuff']), 2),
    roles: ['support'],
    minClock: 600,
    weight: 12,
  },
  {
    itemKey: 'sphere',
    verb: 'Spell-blocks',
    // Linken's only blocks single-target spells — AoE/global BKB-piercers don't count.
    trigger: (t) => atLeast(flagsOf(t, ['pierces-bkb']).filter((f) => f.targeted === true), 1),
    roles: ['core'],
    minClock: 1500,
    weight: 20,
  },
  {
    itemKey: 'aeon_disk',
    verb: 'Survives',
    trigger: (t) => atLeast(flagsOf(t, ['hard-disable', 'undispellable']), 3),
    minClock: 1500,
    weight: 14,
  },
  {
    itemKey: 'monkey_king_bar',
    verb: 'True strike beats',
    trigger: (t) => atLeast(flagsOf(t, ['evasion']), 1),
    roles: ['core'],
    minClock: 1200,
    weight: 22,
  },
  {
    itemKey: 'dust',
    verb: 'Reveals',
    trigger: (t) => atLeast(flagsOf(t, ['invisibility']), 1),
    minClock: 0,
    weight: 25,
  },
  {
    itemKey: 'ward_sentry',
    verb: 'Reveals',
    trigger: (t) => atLeast(flagsOf(t, ['invisibility']), 1),
    roles: ['support'],
    weight: 20,
  },
  {
    itemKey: 'gem',
    verb: 'Reveals',
    trigger: (t) => atLeast(flagsOf(t, ['invisibility']), 1),
    roles: ['core'],
    minClock: 1500,
    weight: 12,
  },
  {
    itemKey: 'spirit_vessel',
    verb: 'Cuts healing from',
    trigger: (t) => atLeast(flagsOf(t, ['sustain']), 1),
    minClock: 600,
    weight: 18,
  },
  {
    itemKey: 'maelstrom',
    verb: 'Clears',
    trigger: (t) => {
      const illusions = flagsOf(t, ['illusions']);
      const summons = flagsOf(t, ['summons']);
      if (illusions.length >= 1 || summons.length >= 2) return [...illusions, ...summons];
      return null;
    },
    roles: ['core'],
    minClock: 600,
    weight: 16,
  },
  {
    itemKey: 'crimson_guard',
    verb: 'Blocks damage from',
    trigger: (t) => atLeast(flagsOf(t, ['summons']), 1),
    roles: ['support'],
    minClock: 900,
    weight: 10,
  },
  {
    itemKey: 'force_staff',
    verb: 'Escapes',
    trigger: (t) => atLeast(flagsOf(t, ['hard-disable']), 2),
    roles: ['support'],
    minClock: 300,
    weight: 13,
  },
];

// Owning an item's upgraded form covers the base recommendation.
const UPGRADED_FORMS: Record<string, string[]> = {
  maelstrom: ['mjollnir'],
  cyclone: ['wind_waker'],
  force_staff: ['hurricane_pike'],
  ward_sentry: ['ward_dispenser'],
};

const MAX_CITED = 3;

function formatCitations(flags: ThreatFlag[]): string {
  const seen = new Set<string>();
  const citations: string[] = [];
  for (const f of flags) {
    const cite = `${f.heroName}'s ${f.abilityName}`;
    if (seen.has(cite)) continue;
    seen.add(cite);
    citations.push(cite);
  }
  const cited = citations.slice(0, MAX_CITED);
  const extra = citations.length - cited.length;
  if (extra > 0) return `${cited.join(', ')} +${extra} more`;
  if (cited.length <= 1) return cited[0] ?? '';
  return `${cited.slice(0, -1).join(', ')} and ${cited[cited.length - 1] ?? ''}`;
}

function priciestAffordableComponent(
  componentKeys: string[],
  items: ItemDataMap,
  gold: number,
): ItemData | null {
  let best: ItemData | null = null;
  for (const key of componentKeys) {
    const component = items[key];
    if (!component || component.cost > gold) continue;
    if (!best || component.cost > best.cost) best = component;
  }
  return best;
}

export function recommendItems(input: ItemEngineInput, items: ItemDataMap): ItemRecommendation[] {
  if (input.threat.enemies.length === 0) return [];
  const clock = input.clock ?? 0;
  const owned = new Set(input.ownedItems);
  const recommendations: ItemRecommendation[] = [];
  for (const rule of RULES) {
    const data = items[rule.itemKey];
    if (!data) continue;
    const covering = [rule.itemKey, ...(UPGRADED_FORMS[rule.itemKey] ?? [])];
    if (covering.some((key) => owned.has(`item_${key}`))) continue;
    if (clock < (rule.minClock ?? 0)) continue;
    if (rule.roles && input.role !== 'unknown' && !rule.roles.includes(input.role)) continue;
    const matched = rule.trigger(input.threat, input);
    if (!matched || matched.length === 0) continue;
    const affordable = input.gold !== null && input.gold >= data.cost;
    const reasons = [`${rule.verb} ${formatCitations(matched)}`];
    if (!affordable && input.gold !== null && data.components) {
      const step = priciestAffordableComponent(data.components, items, input.gold);
      if (step) reasons.push(`Start with ${step.dname} (${step.cost}g)`);
    }
    recommendations.push({
      itemKey: rule.itemKey,
      itemName: data.dname,
      cost: data.cost,
      affordable,
      score: rule.weight * distinctAbilityCount(matched),
      reasons,
    });
  }
  recommendations.sort((a, b) => b.score - a.score || a.cost - b.cost);
  return recommendations;
}
