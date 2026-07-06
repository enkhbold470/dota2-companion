import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const token = process.env.GSI_TOKEN ?? randomBytes(12).toString('hex');
const port = process.env.PORT ?? 53000;

const cfg = `"dota2-companion"
{
  "uri"       "http://127.0.0.1:${port}/"
  "timeout"   "5.0"
  "buffer"    "0.1"
  "throttle"  "0.1"
  "heartbeat" "30.0"
  "data"
  {
    "provider"  "1"
    "map"       "1"
    "player"    "1"
    "hero"      "1"
    "abilities" "1"
    "items"     "1"
  }
  "auth" { "token" "${token}" }
}
`;

const outName = 'gamestate_integration_dota2-companion.cfg';
await writeFile(outName, cfg, 'utf8');
await writeFile('.gsi-token', token, 'utf8');

// Write/update .env so `pnpm listener` works with no shell-specific env setup.
// Preserve everything the user already put there (e.g. OPENAI_API_KEY);
// only the GSI_TOKEN line is replaced to match the freshly written .cfg.
let env = '';
try { env = await readFile('.env', 'utf8'); } catch { /* fresh file */ }
if (/^GSI_TOKEN=/m.test(env)) {
  env = env.replace(/^GSI_TOKEN=.*$/m, `GSI_TOKEN=${token}`);
} else {
  env = `GSI_TOKEN=${token}\n${env}`;
}
if (!/^#?\s*OPENAI_API_KEY=/m.test(env)) {
  env += `${env.endsWith('\n') || env === '' ? '' : '\n'}# Uncomment and fill in to enable Ask Coach (gpt-4o):\n# OPENAI_API_KEY=sk-...\n`;
}
await writeFile('.env', env, 'utf8');

console.log(`Wrote ${outName}, .gsi-token and .env (token: ${token}).`);
console.log('Copy the .cfg into your Dota 2 install:');
console.log('  macOS:   ~/Library/Application Support/Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/');
console.log('  Windows: <Steam>\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\');
console.log('Add -gamestateintegration to Dota 2’s Steam launch options, then run:');
console.log('  pnpm listener');
console.log('Optional: put OPENAI_API_KEY=sk-... in .env to enable Ask Coach.');