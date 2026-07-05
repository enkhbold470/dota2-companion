import { describe, it, expect } from 'vitest';
import type {
  ItemEngineInput,
  ThreatFlag,
  ThreatKind,
  ThreatReport,
} from './coaching-types';
import { ITEM_DATA } from './data';
import { recommendItems } from './items';

function flag(kind: ThreatKind, heroId: number, heroName: string, abilityName: string): ThreatFlag {
  return { kind, heroId, heroName, abilityName };
}

function report(flags: ThreatFlag[], enemyCount = 5): ThreatReport {
  const counts: Partial<Record<ThreatKind, number>> = {};
  for (const f of flags) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  const enemies = Array.from({ length: enemyCount }, (_, i) => ({
    heroId: i + 1,
    heroName: `Enemy ${i + 1}`,
  }));
  return { enemies, flags, counts };
}

function makeInput(overrides: Partial<ItemEngineInput> & { threat: ThreatReport }): ItemEngineInput {
  return { role: 'core', gold: 99999, clock: 1200, ownedItems: [], ...overrides };
}

const magicHeavyFlags = [
  flag('magical-burst', 25, 'Lina', 'Laguna Blade'),
  flag('magical-burst', 26, 'Lion', 'Finger of Death'),
  flag('hard-disable', 26, 'Lion', 'Hex'),
];

describe('recommendItems', () => {
  it('puts BKB on top for a core against a magic-heavy lineup at 20:00', () => {
    const recs = recommendItems(makeInput({ threat: report(magicHeavyFlags) }), ITEM_DATA);
    expect(recs[0]).toMatchObject({
      itemKey: 'black_king_bar',
      itemName: 'Black King Bar',
      cost: 4050,
      affordable: true,
      score: 90,
    });
    expect(recs[0]?.reasons[0]).toBe(
      "Blocks Lina's Laguna Blade, Lion's Finger of Death and Lion's Hex",
    );
    expect(recs.map((r) => r.itemKey)).toContain('pipe');
  });

  it('gives supports glimmer/sentries instead of core items', () => {
    const flags = [...magicHeavyFlags, flag('invisibility', 32, 'Riki', 'Cloak and Dagger')];
    const recs = recommendItems(makeInput({ threat: report(flags), role: 'support' }), ITEM_DATA);
    const keys = recs.map((r) => r.itemKey);
    expect(keys).toContain('glimmer_cape');
    expect(keys).toContain('ward_sentry');
    expect(keys).not.toContain('black_king_bar');
    expect(keys).not.toContain('monkey_king_bar');
    expect(keys).not.toContain('gem');
  });

  it('lets role unknown match role-restricted rules', () => {
    const recs = recommendItems(
      makeInput({ threat: report(magicHeavyFlags), role: 'unknown' }),
      ITEM_DATA,
    );
    const keys = recs.map((r) => r.itemKey);
    expect(keys).toContain('black_king_bar');
    expect(keys).toContain('glimmer_cape');
  });

  it('excludes items the player already owns', () => {
    const recs = recommendItems(
      makeInput({ threat: report(magicHeavyFlags), ownedItems: ['item_black_king_bar'] }),
      ITEM_DATA,
    );
    expect(recs.map((r) => r.itemKey)).not.toContain('black_king_bar');
    expect(recs[0]?.itemKey).toBe('pipe');
  });

  it('marks affordability and suggests the priciest affordable component', () => {
    const recs = recommendItems(makeInput({ threat: report(magicHeavyFlags), gold: 1700 }), ITEM_DATA);
    const bkb = recs.find((r) => r.itemKey === 'black_king_bar');
    expect(bkb).toMatchObject({ affordable: false });
    expect(bkb?.reasons[1]).toBe('Start with Mithril Hammer (1600g)');
  });

  it('omits the component step when no component is affordable, and when gold is null', () => {
    const broke = recommendItems(makeInput({ threat: report(magicHeavyFlags), gold: 500 }), ITEM_DATA);
    const bkbBroke = broke.find((r) => r.itemKey === 'black_king_bar');
    expect(bkbBroke?.affordable).toBe(false);
    expect(bkbBroke?.reasons).toHaveLength(1);

    const noGold = recommendItems(makeInput({ threat: report(magicHeavyFlags), gold: null }), ITEM_DATA);
    const bkbNoGold = noGold.find((r) => r.itemKey === 'black_king_bar');
    expect(bkbNoGold?.affordable).toBe(false);
    expect(bkbNoGold?.reasons).toHaveLength(1);
  });

  it('returns [] when there are no enemies', () => {
    expect(recommendItems(makeInput({ threat: report(magicHeavyFlags, 0) }), ITEM_DATA)).toEqual([]);
  });

  it('gates items on the clock: no BKB at 3:00, dust still fires', () => {
    const flags = [...magicHeavyFlags, flag('invisibility', 32, 'Riki', 'Cloak and Dagger')];
    const recs = recommendItems(makeInput({ threat: report(flags), clock: 180 }), ITEM_DATA);
    const keys = recs.map((r) => r.itemKey);
    expect(keys).not.toContain('black_king_bar');
    expect(keys).toContain('dust');
  });

  it('treats a null clock as 0:00', () => {
    const flags = [...magicHeavyFlags, flag('invisibility', 32, 'Riki', 'Cloak and Dagger')];
    const recs = recommendItems(
      makeInput({ threat: report(flags), role: 'support', clock: null }),
      ITEM_DATA,
    );
    const keys = recs.map((r) => r.itemKey);
    expect(keys).toEqual(expect.arrayContaining(['dust', 'ward_sentry']));
    expect(keys).not.toContain('glimmer_cape');
  });

  it('breaks score ties by putting the cheaper item first', () => {
    const flags = [
      flag('pierces-bkb', 8, 'Juggernaut', 'Omnislash'),
      flag('invisibility', 32, 'Riki', 'Cloak and Dagger'),
    ];
    const recs = recommendItems(
      makeInput({ threat: report(flags), role: 'unknown', clock: 1500 }),
      ITEM_DATA,
    );
    const sentry = recs.find((r) => r.itemKey === 'ward_sentry');
    const sphere = recs.find((r) => r.itemKey === 'sphere');
    expect(sentry?.score).toBe(20);
    expect(sphere?.score).toBe(20);
    expect(recs.indexOf(sentry!)).toBeLessThan(recs.indexOf(sphere!));
  });

  it('skips rules whose item key is missing from the map', () => {
    const { dust: _dust, ...withoutDust } = ITEM_DATA;
    const flags = [flag('invisibility', 32, 'Riki', 'Cloak and Dagger')];
    const recs = recommendItems(
      makeInput({ threat: report(flags), role: 'support' }),
      withoutDust,
    );
    const keys = recs.map((r) => r.itemKey);
    expect(keys).not.toContain('dust');
    expect(keys).toContain('ward_sentry');
  });

  it('ignores BKB-piercing threats when counting toward BKB', () => {
    const flags = [
      flag('magical-burst', 25, 'Lina', 'Laguna Blade'),
      flag('pierces-bkb', 25, 'Lina', 'Laguna Blade'),
      flag('hard-disable', 26, 'Lion', 'Hex'),
    ];
    const recs = recommendItems(makeInput({ threat: report(flags), clock: 1500 }), ITEM_DATA);
    const keys = recs.map((r) => r.itemKey);
    expect(keys).not.toContain('black_king_bar');
    expect(keys).toContain('sphere');
  });

  it('dedupes cited abilities and appends +N more past three', () => {
    const mantaFlags = [
      flag('silence', 75, 'Silencer', 'Global Silence'),
      flag('dispellable-debuff', 75, 'Silencer', 'Global Silence'),
    ];
    const mantaRecs = recommendItems(makeInput({ threat: report(mantaFlags) }), ITEM_DATA);
    const manta = mantaRecs.find((r) => r.itemKey === 'manta');
    expect(manta?.score).toBe(30);
    expect(manta?.reasons[0]).toBe("Dispels Silencer's Global Silence");

    const burstFlags = [
      flag('magical-burst', 25, 'Lina', 'Laguna Blade'),
      flag('magical-burst', 26, 'Lion', 'Finger of Death'),
      flag('magical-burst', 22, 'Zeus', "Thundergod's Wrath"),
      flag('magical-burst', 74, 'Invoker', 'Sun Strike'),
    ];
    const burstRecs = recommendItems(makeInput({ threat: report(burstFlags) }), ITEM_DATA);
    const pipe = burstRecs.find((r) => r.itemKey === 'pipe');
    expect(pipe?.reasons[0]).toBe(
      "Team barrier against Lina's Laguna Blade, Lion's Finger of Death, Zeus's Thundergod's Wrath +1 more",
    );
  });
});
