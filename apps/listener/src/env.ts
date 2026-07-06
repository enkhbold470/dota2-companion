import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal .env loader (no dependency): KEY=VALUE lines, # comments,
 * optional single/double quotes. Real environment variables win over the file.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!m || m[1] === undefined) continue;
    let value = m[2] ?? '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

/**
 * Load the first .env found into process.env without overriding existing vars.
 * pnpm --filter runs the listener from apps/listener, so check the repo root too.
 */
export function loadDotEnv(): string | null {
  for (const path of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parseDotEnv(text))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return path;
  }
  return null;
}
