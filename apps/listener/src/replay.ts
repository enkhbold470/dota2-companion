import './load-env';
import { readFile } from 'node:fs/promises';

const token = process.env.GSI_TOKEN;
if (!token) { console.error('GSI_TOKEN env var is required.'); process.exit(1); }

const port = Number(process.env.PORT ?? 53000);
const file = process.argv[2] ?? 'fixtures/sample-match.json';
const intervalMs = Number(process.env.REPLAY_INTERVAL_MS ?? 1500);

const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
if (!Array.isArray(parsed)) { console.error(`${file} must be a JSON array`); process.exit(1); }
const frames = parsed as Record<string, unknown>[];
console.log(`Replaying ${frames.length} frames from ${file} -> http://127.0.0.1:${port}/ every ${intervalMs}ms`);

for (const frame of frames) {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...frame, auth: { token } }),
  });
  console.log(`  frame -> ${res.status}`);
  await new Promise((r) => setTimeout(r, intervalMs));
}
console.log('Replay complete.');
