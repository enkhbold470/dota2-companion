import { buildServer } from './server';
import { Hub } from './hub';

const token = process.env.GSI_TOKEN;
if (!token) {
  console.error('GSI_TOKEN env var is required. Run `pnpm gen-cfg` first, then export it.');
  process.exit(1);
}

const openaiKey = process.env.OPENAI_API_KEY ?? null;
if (!openaiKey) {
  console.log('OPENAI_API_KEY not set — Ask Coach (POST /coach) is disabled.');
}

const port = Number(process.env.PORT ?? 53000);
const hub = new Hub();
const app = buildServer({ token, hub, openaiKey });

app.listen({ host: '127.0.0.1', port })
  .then(() => console.log(`GSI listener on http://127.0.0.1:${port} (POST /), overlay WS at ws://127.0.0.1:${port}/ws`))
  .catch((err) => { console.error(err); process.exit(1); });
