import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The project .env is the source of truth for this listener's local secrets,
// and we load it *with override* on purpose. A globally-exported OPENAI_API_KEY
// (e.g. from ~/.bashrc pointing at a different provider) would otherwise shadow
// the key the developer put in .env — Node's own --env-file has the opposite
// precedence (real env wins), which silently sends the wrong key upstream.
// Loading here, at the listener's I/O boundary, keeps the override scoped to
// this process and never mutates the user's shell.
const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));

try {
  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== '') process.env[key] = value;
  }
} catch {
  // No .env is fine — vars may come from the real environment instead.
}
