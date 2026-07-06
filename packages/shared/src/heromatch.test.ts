import { describe, it, expect } from 'vitest';
import { matchHeroNames } from './heromatch';
import { HERO_DATA } from './data';

const idOf = (localizedName: string): number => {
  const entry = Object.entries(HERO_DATA).find(([, h]) => h.localizedName === localizedName);
  if (!entry) throw new Error(`no hero ${localizedName}`);
  return Number(entry[0]);
};

describe('matchHeroNames', () => {
  it('resolves exact and loosely-spelled names to ids', () => {
    const ids = matchHeroNames(['Sven', 'anti mage', 'Ogre Magi'], HERO_DATA);
    expect(ids).toEqual([idOf('Sven'), idOf('Anti-Mage'), idOf('Ogre Magi')]);
  });

  it('skips unknown names and de-duplicates', () => {
    const ids = matchHeroNames(['Sven', 'Notahero', 'sven'], HERO_DATA);
    expect(ids).toEqual([idOf('Sven')]);
  });

  it('caps the result', () => {
    const many = ['Sven', 'Axe', 'Lion', 'Lina', 'Zeus', 'Tiny'];
    expect(matchHeroNames(many, HERO_DATA, 5)).toHaveLength(5);
  });
});
