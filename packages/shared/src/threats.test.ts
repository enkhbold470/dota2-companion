import { describe, it, expect } from 'vitest';
import type { AbilityData, HeroDataMap, ThreatKind } from './coaching-types';
import { HERO_DATA, ABILITY_DATA } from './data';
import { buildThreatReport } from './threats';

function kindsOf(key: string, ability: AbilityData): ThreatKind[] {
  const heroes: HeroDataMap = {
    '1': {
      name: 'npc_dota_hero_test',
      localizedName: 'Test Hero',
      attackType: 'Ranged',
      roles: [],
      abilities: [key],
    },
  };
  return buildThreatReport([1], heroes, { [key]: ability }).flags.map((f) => f.kind);
}

describe('buildThreatReport classification rules', () => {
  it('flags magical-burst for big magical nukes blocked by BKB', () => {
    const nuke: AbilityData = {
      dname: 'Nuke',
      dmgType: 'Magical',
      bkbPierce: 'No',
      attribs: [{ key: 'damage', header: 'DAMAGE', value: [100, 200, 300] }],
    };
    expect(kindsOf('test_nuke', nuke)).toContain('magical-burst');
  });

  it('does not flag magical-burst when damage is small, non-magical, or pierces BKB', () => {
    const small: AbilityData = {
      dname: 'Poke',
      dmgType: 'Magical',
      bkbPierce: 'No',
      attribs: [{ key: 'damage', header: 'DAMAGE', value: [50, 100, 140] }],
    };
    expect(kindsOf('test_poke', small)).not.toContain('magical-burst');

    const physical: AbilityData = {
      dname: 'Slash',
      dmgType: 'Physical',
      bkbPierce: 'No',
      attribs: [{ key: 'damage', header: 'DAMAGE', value: [400] }],
    };
    expect(kindsOf('test_slash', physical)).not.toContain('magical-burst');

    const piercing: AbilityData = {
      dname: 'Doom Nuke',
      dmgType: 'Magical',
      bkbPierce: 'Yes',
      attribs: [{ key: 'damage', header: 'DAMAGE', value: [400] }],
    };
    expect(kindsOf('test_doom_nuke', piercing)).not.toContain('magical-burst');
  });

  it('ignores delay/reduction/amp attribs when looking for burst damage', () => {
    const delayed: AbilityData = {
      dname: 'Delayed',
      dmgType: 'Magical',
      bkbPierce: 'No',
      attribs: [
        { key: 'damage_delay', header: 'DELAY', value: [999] },
        { key: 'damage_reduction', header: 'REDUCTION', value: [999] },
        { key: 'spell_amp', header: 'AMP', value: [999] },
      ],
    };
    expect(kindsOf('test_delayed', delayed)).not.toContain('magical-burst');
  });

  it('accepts dmg-style attrib keys for magical-burst', () => {
    const ability: AbilityData = {
      dname: 'Zap',
      dmgType: 'Magical',
      bkbPierce: 'No',
      attribs: [{ key: 'arc_dmg', header: 'DAMAGE', value: [180] }],
    };
    expect(kindsOf('test_zap', ability)).toContain('magical-burst');
  });

  it('flags pierces-bkb only for real offensive effects', () => {
    const withDamage: AbilityData = { dname: 'A', bkbPierce: 'Yes', dmgType: 'Pure' };
    expect(kindsOf('test_a', withDamage)).toContain('pierces-bkb');

    const withDebuff: AbilityData = { dname: 'B', bkbPierce: 'Yes', dispellable: 'No' };
    expect(kindsOf('test_b', withDebuff)).toContain('pierces-bkb');

    const utility: AbilityData = { dname: 'C', bkbPierce: 'Yes' };
    expect(kindsOf('test_c', utility)).not.toContain('pierces-bkb');

    const blocked: AbilityData = { dname: 'D', bkbPierce: 'No', dmgType: 'Magical' };
    expect(kindsOf('test_d', blocked)).not.toContain('pierces-bkb');
  });

  it('flags dispellable-debuff / strong-dispel-debuff / undispellable from dispellable', () => {
    expect(kindsOf('test_e', { dname: 'E', dispellable: 'Yes' })).toContain('dispellable-debuff');
    expect(kindsOf('test_f', { dname: 'F', dispellable: 'Strong Dispels Only' })).toContain(
      'strong-dispel-debuff',
    );
    expect(kindsOf('test_g', { dname: 'G', dispellable: 'No' })).toContain('undispellable');
    expect(kindsOf('test_h', { dname: 'H' })).toEqual([]);
  });

  it('flags hard-disable by ability key', () => {
    for (const key of ['test_stun', 'test_hex', 'sand_king_impale', 'faceless_void_chronosphere']) {
      expect(kindsOf(key, { dname: 'X' })).toContain('hard-disable');
    }
    expect(kindsOf('test_plain_buff', { dname: 'Y' })).not.toContain('hard-disable');
  });

  it('anchors _roar$ and net$ so mid-key matches do not fire', () => {
    expect(kindsOf('test_primal_roar', { dname: 'R' })).toContain('hard-disable');
    expect(kindsOf('test_net', { dname: 'N' })).toContain('hard-disable');
    expect(kindsOf('test_network_link', { dname: 'N2' })).not.toContain('hard-disable');
  });

  it('flags hard-disable via duration + hard dispel + enemy unit target fallback', () => {
    const hexLike: AbilityData = {
      dname: 'Custom Hex',
      dispellable: 'Strong Dispels Only',
      targetTeam: 'Enemy',
      behavior: ['Unit Target'],
      attribs: [{ key: 'duration', header: 'DURATION', value: [2, 3] }],
    };
    expect(kindsOf('test_mystery', hexLike)).toContain('hard-disable');

    const notUnitTarget: AbilityData = {
      dname: 'Ground Thing',
      dispellable: 'No',
      targetTeam: 'Enemy',
      behavior: ['Point Target'],
      attribs: [{ key: 'duration', header: 'DURATION', value: [4] }],
    };
    expect(kindsOf('test_ground', notUnitTarget)).not.toContain('hard-disable');

    const easilyDispelled: AbilityData = {
      dname: 'Weak Debuff',
      dispellable: 'Yes',
      targetTeam: 'Enemy',
      behavior: ['Unit Target'],
      attribs: [{ key: 'duration', header: 'DURATION', value: [4] }],
    };
    expect(kindsOf('test_weak', easilyDispelled)).not.toContain('hard-disable');

    // Long "durations" are buffs/steals (Spell Steal holds for minutes), not stuns.
    const longBuff: AbilityData = {
      dname: 'Stolen Thing',
      dispellable: 'No',
      targetTeam: 'Enemy',
      behavior: ['Unit Target'],
      attribs: [{ key: 'duration', header: 'DURATION', value: [620] }],
    };
    expect(kindsOf('test_long_thing', longBuff)).not.toContain('hard-disable');

    // No targetTeam means we cannot prove it is offensive — no fallback flag.
    const noTeam: AbilityData = {
      dname: 'Mystery',
      dispellable: 'No',
      behavior: ['Unit Target'],
      attribs: [{ key: 'duration', header: 'DURATION', value: [3] }],
    };
    expect(kindsOf('test_no_team', noTeam)).not.toContain('hard-disable');
  });

  it('never reads ally-targeted saves as threats', () => {
    const save: AbilityData = {
      dname: 'Ally Save',
      dispellable: 'Strong Dispels Only',
      targetTeam: 'Friendly',
      behavior: ['Unit Target'],
      attribs: [{ key: 'duration', header: 'DURATION', value: [5] }],
    };
    expect(kindsOf('test_save', save)).toEqual([]);
  });

  it('flags silence by key', () => {
    expect(kindsOf('test_silence', { dname: 'S' })).toContain('silence');
    expect(kindsOf('silencer_global_silence', { dname: 'S' })).toContain('silence');
    expect(kindsOf('skywrath_mage_ancient_seal', { dname: 'S' })).toContain('silence');
    expect(kindsOf('drow_ranger_gust', { dname: 'S' })).toContain('silence');
    expect(kindsOf('test_gusty_wind', { dname: 'S' })).not.toContain('silence');
    // 'silencer' the hero prefix contains 'silence' — must not flag his whole kit.
    expect(kindsOf('silencer_glaives_of_wisdom', { dname: 'S' })).not.toContain('silence');
    expect(kindsOf('silencer_curse_of_the_silent', { dname: 'S' })).not.toContain('silence');
  });

  it('flags invisibility by key', () => {
    for (const key of ['clinkz_wind_walk', 'nyx_assassin_vendetta', 'templar_assassin_meld']) {
      expect(kindsOf(key, { dname: 'I' })).toContain('invisibility');
    }
    expect(kindsOf('test_walk_fast', { dname: 'I' })).not.toContain('invisibility');
    // Shadow Dance can't be revealed by detection — recommending Dust vs Slark is wrong.
    expect(kindsOf('slark_shadow_dance', { dname: 'I' })).not.toContain('invisibility');
  });

  it('flags evasion by key', () => {
    expect(kindsOf('phantom_assassin_blur', { dname: 'V' })).toContain('evasion');
    expect(kindsOf('windrunner_windrun', { dname: 'V' })).toContain('evasion');
    // 'windrunner' the hero prefix contains 'windrun' — must not flag her whole kit.
    expect(kindsOf('windrunner_shackleshot', { dname: 'V' })).not.toContain('evasion');
    expect(kindsOf('windrunner_focusfire', { dname: 'V' })).not.toContain('evasion');
  });

  it('flags illusions by key', () => {
    expect(kindsOf('phantom_lancer_doppelganger', { dname: 'L' })).toContain('illusions');
    expect(kindsOf('chaos_knight_phantasm', { dname: 'L' })).toContain('illusions');
  });

  it('flags summons by key', () => {
    expect(kindsOf('broodmother_spawn_spiderlings', { dname: 'M' })).toContain('summons');
    expect(kindsOf('shadow_shaman_serpent_ward', { dname: 'M' })).toContain('summons');
  });

  it('flags sustain by key but not health-named abilities', () => {
    expect(kindsOf('omniknight_purification', { dname: 'P' })).toContain('sustain');
    expect(kindsOf('lifestealer_feast', { dname: 'P' })).toContain('sustain');
    expect(kindsOf('dazzle_shallow_grave', { dname: 'P' })).toContain('sustain');
    expect(kindsOf('test_health_aura', { dname: 'P' })).not.toContain('sustain');
  });

  it('emits several flags for one ability and tallies counts', () => {
    const hexLike: AbilityData = {
      dname: 'Hexy',
      bkbPierce: 'No',
      dispellable: 'Strong Dispels Only',
      targetTeam: 'Enemy',
      behavior: ['Unit Target'],
      attribs: [{ key: 'duration', header: 'DURATION', value: [2] }],
    };
    const heroes: HeroDataMap = {
      '7': {
        name: 'npc_dota_hero_multi',
        localizedName: 'Multi',
        attackType: 'Melee',
        roles: [],
        abilities: ['multi_hex'],
      },
    };
    const report = buildThreatReport([7], heroes, { multi_hex: hexLike });
    const kinds = report.flags.map((f) => f.kind).sort();
    expect(kinds).toEqual(['hard-disable', 'strong-dispel-debuff']);
    expect(report.counts).toEqual({ 'hard-disable': 1, 'strong-dispel-debuff': 1 });
    expect(report.flags[0]).toMatchObject({ heroId: 7, heroName: 'Multi', abilityName: 'Hexy' });
  });

  it('skips unknown hero ids and unknown ability keys silently', () => {
    const heroes: HeroDataMap = {
      '3': {
        name: 'npc_dota_hero_ghosty',
        localizedName: 'Ghosty',
        attackType: 'Melee',
        roles: [],
        abilities: ['missing_ability'],
      },
    };
    const report = buildThreatReport([3, 9999], heroes, {});
    expect(report.enemies).toEqual([{ heroId: 3, heroName: 'Ghosty' }]);
    expect(report.flags).toEqual([]);
    expect(report.counts).toEqual({});
  });
});

describe('buildThreatReport against real data', () => {
  it('flags Lion: hard-disable + strong-dispel-debuff from Hex, magical-burst from Finger of Death', () => {
    const report = buildThreatReport([26], HERO_DATA, ABILITY_DATA);
    expect(report.enemies).toEqual([{ heroId: 26, heroName: 'Lion' }]);
    expect(report.flags).toContainEqual(expect.objectContaining({
      kind: 'hard-disable',
      heroId: 26,
      heroName: 'Lion',
      abilityName: 'Hex',
      targeted: true,
    }));
    expect(report.flags).toContainEqual(expect.objectContaining({
      kind: 'strong-dispel-debuff',
      heroId: 26,
      heroName: 'Lion',
      abilityName: 'Hex',
    }));
    expect(report.flags).toContainEqual(expect.objectContaining({
      kind: 'magical-burst',
      heroId: 26,
      heroName: 'Lion',
      abilityName: 'Finger of Death',
    }));
  });

  it("flags Axe: Berserker's Call pierces BKB and is undispellable", () => {
    const report = buildThreatReport([2], HERO_DATA, ABILITY_DATA);
    expect(report.flags).toContainEqual(expect.objectContaining({
      kind: 'pierces-bkb',
      heroId: 2,
      heroName: 'Axe',
      abilityName: "Berserker's Call",
    }));
    expect(report.flags).toContainEqual(expect.objectContaining({
      kind: 'undispellable',
      heroId: 2,
      heroName: 'Axe',
      abilityName: "Berserker's Call",
    }));
  });

  it('flags Riki invisibility', () => {
    const report = buildThreatReport([32], HERO_DATA, ABILITY_DATA);
    expect(report.flags.some((f) => f.kind === 'invisibility')).toBe(true);
  });

  it('flags Phantom Assassin evasion', () => {
    const report = buildThreatReport([44], HERO_DATA, ABILITY_DATA);
    expect(report.flags).toContainEqual(expect.objectContaining({
      kind: 'evasion',
      heroId: 44,
      heroName: 'Phantom Assassin',
      abilityName: 'Blur',
    }));
  });

  it('flags Zeus magical-burst', () => {
    const report = buildThreatReport([22], HERO_DATA, ABILITY_DATA);
    expect(report.flags.some((f) => f.kind === 'magical-burst')).toBe(true);
  });

  it('flags Silencer silences and Crystal Maiden dispellable magical damage', () => {
    const silencer = buildThreatReport([75], HERO_DATA, ABILITY_DATA);
    expect(silencer.flags.some((f) => f.kind === 'silence')).toBe(true);

    const cm = buildThreatReport([5], HERO_DATA, ABILITY_DATA);
    expect(cm.flags.some((f) => f.kind === 'magical-burst')).toBe(true);
    expect(cm.flags.some((f) => f.kind === 'dispellable-debuff')).toBe(true);
  });

  it('keeps counts consistent with flags across a full enemy lineup', () => {
    const report = buildThreatReport([26, 2, 32, 44, 22], HERO_DATA, ABILITY_DATA);
    expect(report.enemies).toHaveLength(5);
    const tally: Partial<Record<ThreatKind, number>> = {};
    for (const flag of report.flags) tally[flag.kind] = (tally[flag.kind] ?? 0) + 1;
    expect(report.counts).toEqual(tally);
  });

  it('knows Faceless Void has Chronosphere (facet ability): hard-disable that pierces BKB', () => {
    const report = buildThreatReport([41], HERO_DATA, ABILITY_DATA);
    const chrono = report.flags.filter((f) => f.abilityName === 'Chronosphere');
    expect(chrono.map((f) => f.kind)).toContain('hard-disable');
    expect(chrono.map((f) => f.kind)).toContain('pierces-bkb');
  });

  it('flags only actual silences on Silencer, not his whole kit', () => {
    const report = buildThreatReport([75], HERO_DATA, ABILITY_DATA);
    const silences = report.flags.filter((f) => f.kind === 'silence');
    expect(silences.length).toBeGreaterThan(0);
    expect(silences.map((f) => f.abilityName)).not.toContain('Glaives of Wisdom');
  });

  it('flags only Windrun as evasion on Windranger, not her whole kit', () => {
    const report = buildThreatReport([21], HERO_DATA, ABILITY_DATA);
    const evasion = report.flags.filter((f) => f.kind === 'evasion');
    expect(evasion.map((f) => f.abilityName)).toEqual(['Windrun']);
  });

  it('does not tell players to buy detection against Slark', () => {
    const report = buildThreatReport([93], HERO_DATA, ABILITY_DATA);
    expect(report.flags.filter((f) => f.kind === 'invisibility')).toEqual([]);
  });

  it('flags Mirana invisibility (facet Moonlight Shadow)', () => {
    const report = buildThreatReport([9], HERO_DATA, ABILITY_DATA);
    expect(report.flags.some((f) => f.kind === 'invisibility')).toBe(true);
  });

  it("does not read Dazzle's Shallow Grave as a disable — it is an ally save", () => {
    const report = buildThreatReport([50], HERO_DATA, ABILITY_DATA);
    const grave = report.flags.filter((f) => f.abilityName === 'Shallow Grave');
    expect(grave.map((f) => f.kind)).toEqual(['sustain']);
  });

  it('flags Tidehunter Ravage magical-burst (damage lives in the top-level dmg field)', () => {
    const report = buildThreatReport([29], HERO_DATA, ABILITY_DATA);
    expect(report.flags.some((f) => f.abilityName === 'Ravage' && f.kind === 'magical-burst')).toBe(true);
  });
});
