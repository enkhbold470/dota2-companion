import { describe, it, expect } from 'vitest';
import { buildSkillReadout } from './skills';
import { ABILITY_DATA } from './data';
import type { AbilityDataMap } from './coaching-types';
import type { NormalizedAbility } from './types';

function ability(name: string, level: number, overrides: Partial<NormalizedAbility> = {}): NormalizedAbility {
  return { name, level, canCast: level > 0, cooldown: 0, passive: false, ultimate: false, ...overrides };
}

const DATA: AbilityDataMap = {
  nuke: {
    dname: 'Nuke',
    dmgType: 'Magical',
    cd: [12, 10, 8, 6],
    mc: [100, 120, 140, 160],
    attribs: [
      { key: 'damage_delay', header: 'DAMAGE DELAY', value: [0.5] },
      { key: 'damage', header: 'DAMAGE', value: [100, 200, 300, 400] },
    ],
  },
  broadcast: {
    dname: 'Broadcast',
    dmgType: 'Pure',
    cd: [20, 18, 16, 14],
    mc: [50],
    attribs: [{ key: 'burst_damage', header: 'DAMAGE', value: [500] }],
  },
  aura: {
    dname: 'Aura',
    attribs: [{ key: 'radius', header: 'RADIUS', value: [900] }],
  },
  picky: {
    dname: 'Picky',
    attribs: [
      { key: 'damage_per_interval', header: 'TICK', value: [10, 20, 30] },
      { key: 'bonus_damage', header: 'BONUS', value: [5, 10, 15] },
      { key: 'damage', header: 'DAMAGE', value: [50, 100, 150] },
    ],
  },
  contains_only: {
    dname: 'Contains Only',
    attribs: [
      { key: 'damage_duration', header: 'DURATION', value: [3, 4, 5] },
      { key: 'dmg_per_stack', header: 'PER STACK', value: [7, 14, 21] },
    ],
  },
};

describe('buildSkillReadout', () => {
  it('broadcasts single-element arrays to every level', () => {
    const [readout] = buildSkillReadout([ability('broadcast', 3)], DATA);
    expect(readout).toMatchObject({
      key: 'broadcast',
      name: 'Broadcast',
      maxLevel: 4,
      damage: 500,
      damageNext: null, // level >= single-element array length
      dmgType: 'Pure',
      cooldown: 16,
      manaCost: 50,
    });
  });

  it('at level 0: damage/cooldown/manaCost null, damageNext shows the level-1 value', () => {
    const [readout] = buildSkillReadout([ability('nuke', 0)], DATA);
    expect(readout).toMatchObject({
      level: 0,
      damage: null,
      damageNext: 100,
      cooldown: null,
      manaCost: null,
      dmgType: 'Magical',
    });
  });

  it('at max level damageNext is null', () => {
    const [readout] = buildSkillReadout([ability('nuke', 4)], DATA);
    expect(readout).toMatchObject({ damage: 400, damageNext: null, cooldown: 6, manaCost: 160, maxLevel: 4 });
  });

  it('returns a null-filled entry when the data map has no key', () => {
    const [normal, ult] = buildSkillReadout(
      [ability('mystery', 2, { cooldown: 7.5 }), ability('mystery_ult', 1, { ultimate: true })],
      DATA,
    );
    expect(normal).toMatchObject({
      key: 'mystery',
      name: 'mystery',
      level: 2,
      maxLevel: 4,
      damage: null,
      damageNext: null,
      dmgType: null,
      cooldown: null,
      manaCost: null,
      remainingCooldown: 7.5,
    });
    expect(ult).toMatchObject({ name: 'mystery_ult', maxLevel: 3, ultimate: true });
  });

  it('handles a passive with no damage attrib', () => {
    const [readout] = buildSkillReadout([ability('aura', 1, { passive: true, canCast: null, cooldown: null })], DATA);
    expect(readout).toMatchObject({
      name: 'Aura',
      maxLevel: 4, // no multi-level arrays -> non-ultimate fallback
      damage: null,
      damageNext: null,
      dmgType: null,
      cooldown: null,
      manaCost: null,
      passive: true,
      canCast: null,
      remainingCooldown: null,
    });
  });

  it('prefers the exact damage key and skips excluded keys', () => {
    const [readout] = buildSkillReadout([ability('picky', 2)], DATA);
    expect(readout).toMatchObject({ damage: 100, damageNext: 150, maxLevel: 3 });
  });

  it('falls back to keys containing dmg, still excluding duration-like keys', () => {
    const [readout] = buildSkillReadout([ability('contains_only', 1)], DATA);
    expect(readout).toMatchObject({ damage: 7, damageNext: 14, maxLevel: 3 });
  });

  it('passes through live GSI fields', () => {
    const [readout] = buildSkillReadout([ability('nuke', 1, { cooldown: 4.2, canCast: false })], DATA);
    expect(readout).toMatchObject({ remainingCooldown: 4.2, canCast: false, ultimate: false, passive: false });
  });

  it('reads a real Lion kit from ABILITY_DATA', () => {
    const kit = [
      ability('lion_impale', 4),
      ability('lion_voodoo', 3),
      ability('lion_mana_drain', 2),
      ability('lion_finger_of_death', 2, { ultimate: true }),
    ];
    const [impale, voodoo, drain, finger] = buildSkillReadout(kit, ABILITY_DATA);

    const impaleDamage = ABILITY_DATA['lion_impale']?.attribs?.find((a) => a.key === 'damage')?.value[3];
    expect(impaleDamage).toBeTypeOf('number');
    expect(impale).toMatchObject({ name: 'Earth Spike', dmgType: 'Magical', damage: impaleDamage, damageNext: null });

    const fingerDamage = ABILITY_DATA['lion_finger_of_death']?.attribs?.find((a) => a.key === 'damage')?.value[1];
    expect(fingerDamage).toBeTypeOf('number');
    expect(finger).toMatchObject({ name: 'Finger of Death', maxLevel: 3, damage: fingerDamage });

    expect(voodoo?.damage).toBeNull();
    expect(voodoo?.cooldown).toBeTypeOf('number');
    expect(voodoo?.manaCost).toBeTypeOf('number');
    expect(voodoo?.name).toBe('Hex');

    expect(drain?.name).toBe('Mana Drain');
    expect(drain?.damage).toBeNull();
  });
});
