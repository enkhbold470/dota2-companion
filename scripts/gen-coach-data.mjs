// Prunes dotaconstants into the small static dataset the coaching engines need.
// Run `node scripts/gen-coach-data.mjs` after bumping dotaconstants (patch day);
// output is checked in so runtime never loads the full 2.5MB of constants.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  path.join(fileURLToPath(new URL('..', import.meta.url)), 'apps/overlay/package.json'),
);

const abilities = require('dotaconstants/build/abilities.json');
const heroAbilities = require('dotaconstants/build/hero_abilities.json');
const heroes = require('dotaconstants/build/heroes.json');
const items = require('dotaconstants/build/items.json');
const dcVersion = require('dotaconstants/package.json').version;

const OUT_DIR = path.join(fileURLToPath(new URL('..', import.meta.url)), 'packages/shared/src/data');

// Attrib keys worth keeping: damage numbers plus the few that describe threat
// severity (durations of disables). Everything else is tooltip noise.
const KEEP_ATTRIB = /damage|dmg|duration|dps|burn|strike|impact/i;
const DROP_ATTRIB = /tooltip|scepter|talent|creep|illusion_|cast|channel|vision|bonus_speed/i;

const toNums = (v) => {
  const arr = Array.isArray(v) ? v : [v];
  const nums = arr.map((x) => Number(x));
  return nums.every((n) => Number.isFinite(n)) ? nums : null;
};

function pruneAbility(key) {
  const a = abilities[key];
  if (!a || !a.dname) return null;
  const attribs = [];
  for (const at of a.attrib ?? []) {
    if (!at.key || !KEEP_ATTRIB.test(at.key) || DROP_ATTRIB.test(at.key)) continue;
    const value = toNums(at.value);
    if (!value || value.every((n) => n === 0)) continue;
    attribs.push({ key: at.key, header: (at.header ?? '').replace(/:$/, ''), value });
  }
  // Source data is inconsistently typed (e.g. bkbpierce: [] on a few abilities);
  // only emit values from the documented enums.
  const out = { dname: a.dname };
  if (['Magical', 'Physical', 'Pure'].includes(a.dmg_type)) out.dmgType = a.dmg_type;
  if (['Yes', 'No'].includes(a.bkbpierce)) out.bkbPierce = a.bkbpierce;
  if (['Yes', 'No', 'Strong Dispels Only'].includes(a.dispellable)) out.dispellable = a.dispellable;
  if (a.behavior) out.behavior = Array.isArray(a.behavior) ? a.behavior : [a.behavior];
  const cd = toNums(a.cd);
  if (cd) out.cd = cd;
  const mc = toNums(a.mc);
  if (mc) out.mc = mc;
  if (attribs.length) out.attribs = attribs;
  if (a.is_innate) out.isInnate = true;
  return out;
}

const heroesOut = {};
const abilitiesOut = {};
for (const h of Object.values(heroes)) {
  const ha = heroAbilities[h.name];
  if (!ha) continue;
  const abilityKeys = (ha.abilities ?? []).filter((k) => {
    if (k === 'generic_hidden') return false;
    const pruned = pruneAbility(k);
    if (!pruned) return false;
    abilitiesOut[k] = pruned;
    return true;
  });
  heroesOut[h.id] = {
    name: h.name,
    localizedName: h.localized_name,
    attackType: h.attack_type,
    roles: h.roles ?? [],
    abilities: abilityKeys,
  };
}

const itemsOut = {};
for (const [key, it] of Object.entries(items)) {
  if (!it.dname || typeof it.cost !== 'number' || it.cost <= 0) continue;
  if (key.startsWith('recipe_')) continue;
  itemsOut[key] = { dname: it.dname, cost: it.cost };
  if (Array.isArray(it.components) && it.components.length) {
    itemsOut[key].components = it.components.filter((c) => c && !c.startsWith('recipe'));
  }
}

await mkdir(OUT_DIR, { recursive: true });
const write = async (name, data) => {
  const json = JSON.stringify(data);
  await writeFile(path.join(OUT_DIR, name), json, 'utf8');
  console.log(`${name}: ${(json.length / 1024).toFixed(0)} KB`);
};
await write('hero-data.json', heroesOut);
await write('ability-data.json', abilitiesOut);
await write('item-data.json', itemsOut);
await write('data-meta.json', { source: 'dotaconstants', version: dcVersion });
console.log(`Pruned from dotaconstants@${dcVersion}.`);
