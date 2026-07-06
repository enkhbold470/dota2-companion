import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerRecordingRoute } from './recording-route';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'nf-rec-'));
  dirs.push(d);
  return d;
}
function buildApp(defaultDir: string): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 64_000_000 });
  registerRecordingRoute(app, { defaultDir });
  return app;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('recording route', () => {
  it('writes the session to the default dir and returns the path', async () => {
    const dir = tempDir();
    const app = buildApp(dir);
    const session = { format: 'neurofocus_ble_eeg_v1', samples: [1, 2, 3], focus: [] };
    const res = await app.inject({
      method: 'POST', url: '/recording',
      payload: { filename: 'neurofocus-dota-2026.json', session },
    });
    expect(res.statusCode).toBe(200);
    const { ok, file } = res.json() as { ok: boolean; file: string };
    expect(ok).toBe(true);
    expect(file).toBe(join(dir, 'neurofocus-dota-2026.json'));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(session);
    await app.close();
  });

  it('rejects a body with no session', async () => {
    const app = buildApp(tempDir());
    const res = await app.inject({ method: 'POST', url: '/recording', payload: { filename: 'x.json' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'no-session' });
    await app.close();
  });

  it('sanitizes traversal attempts and forces a .json name inside the dir', async () => {
    const dir = tempDir();
    const app = buildApp(dir);
    const res = await app.inject({
      method: 'POST', url: '/recording',
      payload: { filename: '../../etc/passwd', session: { ok: 1 } },
    });
    expect(res.statusCode).toBe(200);
    const { file } = res.json() as { file: string };
    // Everything stays inside the target dir; no parent escape survives.
    expect(file.startsWith(dir)).toBe(true);
    expect(file.includes('..')).toBe(false);
    expect(file.endsWith('.json')).toBe(true);
    expect(readdirSync(dir).every((f) => f.endsWith('.json'))).toBe(true);
    await app.close();
  });

  it('falls back to the default dir when the client path is not absolute', async () => {
    const dir = tempDir();
    const app = buildApp(dir);
    const res = await app.inject({
      method: 'POST', url: '/recording',
      payload: { dir: 'relative/path', filename: 'a.json', session: { ok: 1 } },
    });
    expect(res.statusCode).toBe(200);
    expect(existsSync(join(dir, 'a.json'))).toBe(true);
    await app.close();
  });

  it('locks CORS to the overlay origin on preflight', async () => {
    const app = buildApp(tempDir());
    const res = await app.inject({ method: 'OPTIONS', url: '/recording' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5273');
    await app.close();
  });
});
