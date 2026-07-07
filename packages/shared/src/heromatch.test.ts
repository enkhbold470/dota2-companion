import { describe, it, expect } from 'vitest';
import { matchHeroNames, splitDraftByTeam } from './heromatch';
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

  it('resolves the current in-game rename "Outworld Destroyer" to the stored Outworld Devourer', () => {
    expect(matchHeroNames(['Outworld Destroyer'], HERO_DATA)).toEqual([idOf('Outworld Devourer')]);
    expect(matchHeroNames(['OD'], HERO_DATA)).toEqual([idOf('Outworld Devourer')]);
  });

  it('resolves legacy/community names via internal npc names and aliases', () => {
    expect(matchHeroNames(['Windrunner'], HERO_DATA)).toEqual([idOf('Windranger')]);
    expect(matchHeroNames(['Furion'], HERO_DATA)).toEqual([idOf("Nature's Prophet")]);
    expect(matchHeroNames(['Necrolyte'], HERO_DATA)).toEqual([idOf('Necrophos')]);
    expect(matchHeroNames(['Wisp'], HERO_DATA)).toEqual([idOf('Io')]);
    expect(matchHeroNames(['Skeleton King'], HERO_DATA)).toEqual([idOf('Wraith King')]);
    expect(matchHeroNames(['Nevermore'], HERO_DATA)).toEqual([idOf('Shadow Fiend')]);
  });

  it('rescues near-miss spellings with the fuzzy pass', () => {
    expect(matchHeroNames(['Jugernaut'], HERO_DATA)).toEqual([idOf('Juggernaut')]);
    expect(matchHeroNames(['Crystal Maden'], HERO_DATA)).toEqual([idOf('Crystal Maiden')]);
    expect(matchHeroNames(['Templar Asassin'], HERO_DATA)).toEqual([idOf('Templar Assassin')]);
  });

  it('never guesses on garbage or ambiguous input', () => {
    expect(matchHeroNames(['Notahero', 'xyz', ''], HERO_DATA)).toEqual([]);
  });
});

describe('splitDraftByTeam', () => {
  const draft = {
    radiant: ['Sven', 'Lion', 'Zeus', 'Axe', 'Lina'],
    dire: ['Anti-Mage', 'Tiny', 'Crystal Maiden', 'Ogre Magi', 'Juggernaut'],
  };

  it('when we are radiant: enemies = dire, allies = radiant minus our hero', () => {
    const own = idOf('Sven');
    const { enemies, allies } = splitDraftByTeam('radiant', draft, own, HERO_DATA);
    expect(enemies).toEqual(matchHeroNames(draft.dire, HERO_DATA));
    expect(allies).toEqual([idOf('Lion'), idOf('Zeus'), idOf('Axe'), idOf('Lina')]);
    expect(allies).not.toContain(own);
  });

  it('when we are dire: sides swap', () => {
    const { enemies, allies } = splitDraftByTeam('dire', draft, idOf('Anti-Mage'), HERO_DATA);
    expect(enemies).toEqual(matchHeroNames(draft.radiant, HERO_DATA));
    expect(allies).toEqual([idOf('Tiny'), idOf('Crystal Maiden'), idOf('Ogre Magi'), idOf('Juggernaut')]);
  });

  it('returns empty when our team is unknown (fall back to manual)', () => {
    expect(splitDraftByTeam(null, draft, null, HERO_DATA)).toEqual({ enemies: [], allies: [] });
  });
});
