// Generates the per-hero FUN item pool (packages/shared/src/data/hero-builds.json)
// by asking the LLM once per hero, offline. Output is checked in like the other
// generated data — runtime never calls the LLM for this. Re-run after `gen-data`
// on patch day: `node scripts/gen-hero-builds.mjs` (resumes; --force regenerates,
// --hero "Anti-Mage" for one-offs, --model to override).
//
// Requires OPENAI_API_KEY in the repo .env (loaded with override, same policy as
// apps/listener/src/load-env.ts) or the environment. Cost: ~$1.50 for 127 heroes.
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = path.join(ROOT, 'packages/shared/src/data');
const OUT_FILE = path.join(DATA_DIR, 'hero-builds.json');

const MODEL = argValue('--model') ?? 'gpt-5.4';
const FORCE = process.argv.includes('--force');
const ONLY_HERO = argValue('--hero');
const CONCURRENCY = 4;
const MIN_ITEMS = 6;

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

// .env wins over the shell, same as the listener's load-env.ts (a ~/.bashrc
// OPENAI_API_KEY pointing at another provider must not shadow the project key).
function loadDotEnv() {
  try {
    const text = readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key !== '') process.env[key] = value;
    }
  } catch { /* no .env is fine */ }
}

loadDotEnv();
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error('OPENAI_API_KEY missing (put it in the repo .env).');
  process.exit(1);
}

const heroes = JSON.parse(readFileSync(path.join(DATA_DIR, 'hero-data.json'), 'utf8'));
const items = JSON.parse(readFileSync(path.join(DATA_DIR, 'item-data.json'), 'utf8'));
const abilities = JSON.parse(readFileSync(path.join(DATA_DIR, 'ability-data.json'), 'utf8'));

// Same fold as packages/shared/src/itemmatch.ts so the checked-in keys always
// resolve at runtime: display names first, then raw keys where free.
const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const itemKeyByName = new Map();
for (const [key, data] of Object.entries(items)) {
  const n = normalize(data.dname);
  if (!itemKeyByName.has(n)) itemKeyByName.set(n, key);
}
for (const key of Object.keys(items)) {
  const n = normalize(key);
  if (!itemKeyByName.has(n)) itemKeyByName.set(n, key);
}

const SCHEMA = {
  type: 'json_schema',
  name: 'fun_build',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        minItems: 8,
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Exact in-game item name, e.g. "Ethereal Blade"' },
            why: { type: 'string', description: 'Punchy reason, 10 words max' },
          },
          required: ['name', 'why'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

const INSTRUCTIONS =
  'You curate a FUN item pool for one Dota 2 hero: spicy, high-impact, meme-but-works picks that are genuinely castable/usable on this hero ' +
  '(caster vs carry, melee vs ranged, right attack type). Think big magic burst, big crits, greedy tempo, silly-but-legal combos — fun over safe, ' +
  'but every item must actually function on the hero. 8–12 items, most fun first, exact in-game shop item names only (no Roshan-only items like ' +
  '"Aghanim\'s Blessing" — use "Aghanim\'s Scepter"). One punchy reason each, 10 words max.';

function heroPrompt(hero, invalidNames) {
  const abilityNames = hero.abilities
    .map((key) => abilities[key]?.dname)
    .filter(Boolean)
    .join(', ');
  let p = `Hero: ${hero.localizedName}\nAttack type: ${hero.attackType}\nRoles: ${hero.roles.join(', ')}\nAbilities: ${abilityNames}`;
  if (invalidNames?.length) {
    p += `\n\nThese are NOT real shop items — do not use them: ${invalidNames.join(', ')}.`;
  }
  return p;
}

async function callModel(hero, invalidNames) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      instructions: INSTRUCTIONS,
      input: heroPrompt(hero, invalidNames),
      // Generous: reasoning tokens count against this and truncated JSON fails the run.
      reasoning: { effort: 'medium' },
      max_output_tokens: 6000,
      text: { format: SCHEMA },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  let text = '';
  for (const item of data.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') text += part.text;
    }
  }
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

function validate(rawItems) {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  for (const it of rawItems) {
    if (!it || typeof it.name !== 'string') continue;
    const key = itemKeyByName.get(normalize(it.name));
    if (!key) { invalid.push(it.name); continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({ key, name: items[key].dname, why: typeof it.why === 'string' ? it.why : '' });
  }
  return { valid, invalid };
}

async function generateHero(id, hero) {
  let { valid, invalid } = validate(await callModel(hero));
  if (valid.length < MIN_ITEMS) {
    // One retry, telling the model which names didn't resolve.
    ({ valid, invalid } = validate(await callModel(hero, invalid)));
  }
  if (valid.length < MIN_ITEMS) {
    throw new Error(`only ${valid.length} valid items after retry (bad: ${invalid.join(', ')})`);
  }
  return { fun: valid };
}

async function main() {
  let existing = {};
  if (!FORCE) {
    try { existing = JSON.parse(readFileSync(OUT_FILE, 'utf8')); } catch { /* first run */ }
  }

  const targets = Object.entries(heroes).filter(([id, h]) => {
    if (ONLY_HERO) return normalize(h.localizedName) === normalize(ONLY_HERO);
    return !existing[id]?.fun?.length;
  });
  console.log(`heroes to generate: ${targets.length} (model ${MODEL}, ${Object.keys(existing).length} already present)`);

  const out = { ...existing };
  const failures = [];
  let done = 0;

  const queue = [...targets];
  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [id, hero] = next;
      try {
        out[id] = await generateHero(id, hero);
        done += 1;
        console.log(`  [${done}/${targets.length}] ${hero.localizedName}: ${out[id].fun.length} items`);
      } catch (err) {
        failures.push(hero.localizedName);
        console.error(`  FAILED ${hero.localizedName}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // Stable numeric order keeps diffs readable.
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => Number(a) - Number(b)));
  await writeFile(OUT_FILE, JSON.stringify(sorted));
  const kb = (JSON.stringify(sorted).length / 1024).toFixed(1);
  console.log(`wrote ${OUT_FILE} (${Object.keys(sorted).length} heroes, ${kb} KB)`);
  if (failures.length) {
    console.error(`failed heroes (re-run to resume): ${failures.join(', ')}`);
    process.exit(1);
  }
}

await main();
