import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerVideoRoute } from './video-route';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'nf-vid-'));
  dirs.push(d);
  return d;
}
function buildApp(defaultDir: string): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 64_000_000 });
  registerVideoRoute(app, { defaultDir });
  return app;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('video upload', () => {
  it('start creates an empty .webm, chunks append in order, finish reports size', async () => {
    const dir = tempDir();
    const app = buildApp(dir);

    const start = await app.inject({
      method: 'POST', url: '/video/start', payload: { filename: 'a.webm' },
    });
    expect(start.statusCode).toBe(200);
    expect(existsSync(join(dir, 'a.webm'))).toBe(true);

    for (const part of ['hello ', 'world']) {
      const res = await app.inject({
        method: 'POST', url: '/video/chunk?name=a.webm',
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from(part),
      });
      expect(res.statusCode).toBe(200);
    }
    expect(readFileSync(join(dir, 'a.webm'), 'utf8')).toBe('hello world');

    const fin = await app.inject({ method: 'POST', url: '/video/finish', payload: { name: 'a.webm' } });
    expect(fin.statusCode).toBe(200);
    expect((fin.json() as { bytes: number }).bytes).toBe(11);
    await app.close();
  });

  it('start truncates an existing file so a re-record starts clean', async () => {
    const dir = tempDir();
    const app = buildApp(dir);
    writeFileSync(join(dir, 'a.webm'), 'stale');
    const res = await app.inject({ method: 'POST', url: '/video/start', payload: { filename: 'a.webm' } });
    expect(res.statusCode).toBe(200);
    expect(readFileSync(join(dir, 'a.webm'), 'utf8')).toBe('');
    await app.close();
  });

  it('rejects traversal and non-webm names', async () => {
    const app = buildApp(tempDir());
    for (const filename of ['../evil.webm', 'a/b.webm', '.hidden.webm', 'x.exe', 'x.json']) {
      const res = await app.inject({ method: 'POST', url: '/video/start', payload: { filename } });
      expect(res.statusCode, filename).toBe(400);
    }
    await app.close();
  });
});

describe('recordings listing', () => {
  it('lists session-head metadata without reading whole files, plus videos', async () => {
    const dir = tempDir();
    const app = buildApp(dir);
    const session = {
      format: 'neurofocus_ble_eeg_v2', startedAtMs: 111, endedAtMs: 222, durationSec: 60,
      matchId: '42', video: { filename: 'v.webm', startedAtMs: 115 },
      focus: [], events: [],
      samples: Array.from({ length: 100_000 }, (_, i) => i),
    };
    writeFileSync(join(dir, 's.json'), JSON.stringify(session));
    writeFileSync(join(dir, 'v.webm'), 'xxxx');

    const res = await app.inject({ method: 'GET', url: '/recordings' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      sessions: { name: string; head: { startedAtMs: number; video: { filename: string } | null } | null }[];
      videos: { name: string; size: number }[];
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]!.name).toBe('s.json');
    expect(body.sessions[0]!.head?.startedAtMs).toBe(111);
    expect(body.sessions[0]!.head?.video?.filename).toBe('v.webm');
    expect(body.videos).toEqual([{ name: 'v.webm', size: 4, mtimeMs: expect.any(Number) }]);
    await app.close();
  });

  it('returns empty lists when the folder does not exist yet', async () => {
    const dir = join(tempDir(), 'nope');
    const app = buildApp(dir);
    const res = await app.inject({ method: 'GET', url: '/recordings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ dir, sessions: [], videos: [] });
    await app.close();
  });
});

describe('file serving with Range', () => {
  it('serves the whole file with accept-ranges', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'v.webm'), '0123456789');
    const app = buildApp(dir);
    const res = await app.inject({ method: 'GET', url: '/recordings/file?name=v.webm' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toContain('video/webm');
    expect(res.body).toBe('0123456789');
    await app.close();
  });

  it('serves a bounded range as 206 with content-range', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'v.webm'), '0123456789');
    const app = buildApp(dir);
    const res = await app.inject({
      method: 'GET', url: '/recordings/file?name=v.webm', headers: { range: 'bytes=2-5' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 2-5/10');
    expect(res.body).toBe('2345');
    await app.close();
  });

  it('serves open-ended and suffix ranges', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'v.webm'), '0123456789');
    const app = buildApp(dir);

    const tail = await app.inject({
      method: 'GET', url: '/recordings/file?name=v.webm', headers: { range: 'bytes=7-' },
    });
    expect(tail.statusCode).toBe(206);
    expect(tail.body).toBe('789');

    const suffix = await app.inject({
      method: 'GET', url: '/recordings/file?name=v.webm', headers: { range: 'bytes=-4' },
    });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.body).toBe('6789');
    expect(suffix.headers['content-range']).toBe('bytes 6-9/10');
    await app.close();
  });

  it('answers 416 for an unsatisfiable range and 404 for a missing file', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'v.webm'), '0123');
    const app = buildApp(dir);
    const res = await app.inject({
      method: 'GET', url: '/recordings/file?name=v.webm', headers: { range: 'bytes=99-' },
    });
    expect(res.statusCode).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */4');

    const missing = await app.inject({ method: 'GET', url: '/recordings/file?name=zz.webm' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('rejects unsafe names before touching the filesystem', async () => {
    const app = buildApp(tempDir());
    const res = await app.inject({ method: 'GET', url: `/recordings/file?name=${encodeURIComponent('../secret.webm')}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('CORS', () => {
  it('locks preflight to the overlay origin', async () => {
    const app = buildApp(tempDir());
    const res = await app.inject({ method: 'OPTIONS', url: '/video/start' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5273');
    await app.close();
  });
});
