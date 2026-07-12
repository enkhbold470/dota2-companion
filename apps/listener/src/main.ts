import './load-env';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildServer } from './server';
import { Hub } from './hub';

const token = process.env.GSI_TOKEN;
if (!token) {
  console.error('GSI_TOKEN env var is required. Run `pnpm gen-cfg` first, then export it.');
  process.exit(1);
}

// If the overlay has been built, serve it from this same process (one command,
// one port). Falls back to dev mode (Vite on :5273) when it hasn't.
const overlayDist = fileURLToPath(new URL('../../overlay/dist', import.meta.url));
const staticDir = process.env.STATIC_DIR ?? (existsSync(overlayDist) ? overlayDist : undefined);

const openaiKey = process.env.OPENAI_API_KEY ?? null;
if (!openaiKey) {
  console.log('OPENAI_API_KEY not set — Ask Coach (POST /coach) is disabled.');
}

const port = Number(process.env.PORT ?? 53000);
const hub = new Hub();
const app = buildServer({
  token, hub, openaiKey, staticDir,
  // Override when the overlay is served from a non-default host/port.
  coachAllowOrigin: process.env.COACH_ALLOW_ORIGIN,
});

app.listen({ host: '127.0.0.1', port })
  .then(() => {
    if (staticDir) {
      console.log(`Dota 2 NeuroSync running — open http://127.0.0.1:${port} in your browser.`);
    } else {
      console.log(`GSI listener on http://127.0.0.1:${port} (POST /), overlay WS at ws://127.0.0.1:${port}/ws — run the overlay dev server separately (pnpm overlay).`);
    }
  })
  .catch((err) => { console.error(err); process.exit(1); });
