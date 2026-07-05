import { describe, it } from 'vitest';
import { buildThreatReport } from './threats';
import { recommendItems } from './items';
import { HERO_DATA, ABILITY_DATA, ITEM_DATA } from './data';

const SVEN = 18;
const OMNI = 57;
const OGRE = 84;

function run(label: string, enemyIds: number[], role: 'core' | 'support') {
  const threat = buildThreatReport(enemyIds, HERO_DATA, ABILITY_DATA);
  console.log(`\n=== ${label} (role=${role}) ===`);
  console.log(
    'flags:',
    threat.flags.map((f) => `${f.kind}:${f.heroName}/${f.abilityName}`).join(' | '),
  );
  const recs = recommendItems(
    { threat, role, gold: 99999, clock: 2000, ownedItems: [], attackType: 'Melee' },
    ITEM_DATA,
  );
  for (const r of recs) console.log(`REC ${r.itemName}: ${r.reasons.join(' ; ')}`);
}

describe('repro', () => {
  it('enemy = Sven alone, core', () => run('Sven alone', [SVEN], 'core'));
  it('enemy = Sven alone, support', () => run('Sven alone', [SVEN], 'support'));
  it('enemy = Omniknight alone, support', () => run('Omniknight alone', [OMNI], 'support'));
  it('enemy = Ogre Magi alone, support', () => run('Ogre alone', [OGRE], 'support'));
  it('enemy = Omni + Ogre, support', () => run('Omni + Ogre', [OMNI, OGRE], 'support'));
});
