// Prunes dotaconstants into the small static dataset the coaching engines need.
// Run `node scripts/gen-coach-data.mjs` after bumping dotaconstants (patch day);
// output is checked in so runtime never loads the full 2.5MB of constants.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  path.join(fileURLToPath(new URL('..', import.meta.url)), 'package.json'),
);

// dotaconstants 10.x restricts its `exports` to the package index, so the old
// `dotaconstants/build/*.json` subpath requires no longer resolve. Pull the
// datasets off the index instead, and read the package version straight off
// the resolved package.json on disk (that subpath isn't exported either).
const dc = require('dotaconstants');
const abilities = dc.abilities;
const heroAbilities = dc.hero_abilities;
const heroes = dc.heroes;
const items = dc.items;
const itemIds = dc.item_ids;
const dcVersion = JSON.parse(
  readFileSync(path.join(path.dirname(require.resolve('dotaconstants')), 'package.json'), 'utf8'),
).version;
// The trailing entry of dc.patch is the latest major game patch (e.g. "7.41").
const gamePatch = dc.patch?.[dc.patch.length - 1]?.name ?? null;

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

// target_team is 'Enemy' | 'Friendly' | 'Both' | an array of those | absent.
function normalizeTargetTeam(tt) {
  const arr = Array.isArray(tt) ? tt : [tt];
  const hasEnemy = arr.includes('Enemy') || arr.includes('Both');
  const hasFriendly = arr.includes('Friendly') || arr.includes('Both');
  if (hasEnemy && hasFriendly) return 'Both';
  if (hasEnemy) return 'Enemy';
  if (hasFriendly) return 'Friendly';
  return null;
}

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
  // Some abilities (Ravage, Storm Hammer, ...) carry their primary damage in a
  // top-level `dmg` field instead of an attrib row.
  if (!attribs.some((at) => /damage|dmg/.test(at.key))) {
    const dmg = toNums(a.dmg);
    if (dmg && dmg.some((n) => n > 0)) attribs.unshift({ key: 'damage', header: 'DAMAGE', value: dmg });
  }
  // Source data is inconsistently typed (e.g. bkbpierce: [] on a few abilities);
  // only emit values from the documented enums.
  const out = { dname: a.dname };
  if (['Magical', 'Physical', 'Pure'].includes(a.dmg_type)) out.dmgType = a.dmg_type;
  if (['Yes', 'No'].includes(a.bkbpierce)) out.bkbPierce = a.bkbpierce;
  if (['Yes', 'No', 'Strong Dispels Only'].includes(a.dispellable)) out.dispellable = a.dispellable;
  const targetTeam = normalizeTargetTeam(a.target_team);
  if (targetTeam) out.targetTeam = targetTeam;
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
  // Facet-gated abilities (e.g. Faceless Void's Chronosphere/Time Zone) live
  // under facets[].abilities, not the base list. We can't know which facet the
  // player picked, so include them all — better to warn about a possible
  // Chronosphere than to not know it exists.
  const facetKeys = (ha.facets ?? []).flatMap((f) => f.abilities ?? []);
  const abilityKeys = [...new Set([...(ha.abilities ?? []), ...facetKeys])].filter((k) => {
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
// Numeric item id → item key, for decoding OpenDota match payloads (item_0..item_5).
await write('item-ids.json', itemIds ?? {});
await write('data-meta.json', { source: 'dotaconstants', version: dcVersion, gamePatch });
console.log(`Pruned from dotaconstants@${dcVersion} (game patch ${gamePatch}).`);
