import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerOpenDotaRoute, type OpenDotaRouteOptions } from './opendota-route';

function buildApp(opts: OpenDotaRouteOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  registerOpenDotaRoute(app, opts);
  return app;
}

const MATCH = JSON.stringify({ match_id: 8000000001, duration: 2400, players: [] });

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'od-cache-test-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('opendota proxy', () => {
  it('proxies a match and caches it (memory + disk) so upstream is hit once', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL) => Promise.resolve(new Response(MATCH, { status: 200 })));
    const app = buildApp({ fetchImpl: fetchMock as unknown as typeof fetch, cacheDir: dir });

    const res1 = await app.inject({ method: 'GET', url: '/opendota/match/8000000001' });
    expect(res1.statusCode).toBe(200);
    expect(res1.json()).toEqual(JSON.parse(MATCH));

    const res2 = await app.inject({ method: 'GET', url: '/opendota/match/8000000001' });
    expect(res2.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.opendota.com/api/matches/8000000001');

    const onDisk = await readFile(join(dir, 'od-cache', 'match-8000000001.json'), 'utf8');
    expect(JSON.parse(onDisk).match_id).toBe(8000000001);
    await app.close();
  });

  it('serves from the disk cache after a restart (fresh memory)', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL) => Promise.resolve(new Response(MATCH, { status: 200 })));
    const app1 = buildApp({ fetchImpl: fetchMock as unknown as typeof fetch, cacheDir: dir });
    await app1.inject({ method: 'GET', url: '/opendota/match/8000000001' });
    await app1.close();

    const coldFetch = vi.fn();
    const app2 = buildApp({ fetchImpl: coldFetch as unknown as typeof fetch, cacheDir: dir });
    const res = await app2.inject({ method: 'GET', url: '/opendota/match/8000000001' });
    expect(res.statusCode).toBe(200);
    expect(coldFetch).not.toHaveBeenCalled();
    await app2.close();
  });

  it('rejects a malformed match id with 400 and maps upstream errors to 502', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL) => Promise.resolve(new Response('down', { status: 503 })));
    const app = buildApp({ fetchImpl: fetchMock as unknown as typeof fetch });
    expect((await app.inject({ method: 'GET', url: '/opendota/match/abc' })).statusCode).toBe(400);
    const res = await app.inject({ method: 'GET', url: '/opendota/match/123' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'upstream', status: 503 });
    await app.close();
  });

  it('does not cache non-match 200 bodies (OpenDota error payloads)', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL) => Promise.resolve(new Response('{"error":"rate limited"}', { status: 200 })));
    const app = buildApp({ fetchImpl: fetchMock as unknown as typeof fetch, cacheDir: dir });
    await app.inject({ method: 'GET', url: '/opendota/match/123' });
    await app.inject({ method: 'GET', url: '/opendota/match/123' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('caches recent matches with a TTL and validates the account id', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL) => Promise.resolve(new Response('[]', { status: 200 })));
    const app = buildApp({ fetchImpl: fetchMock as unknown as typeof fetch });
    expect((await app.inject({ method: 'GET', url: '/opendota/players/52079950/recent' })).statusCode).toBe(200);
    await app.inject({ method: 'GET', url: '/opendota/players/52079950/recent' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/players/52079950/recentMatches');
    expect((await app.inject({ method: 'GET', url: '/opendota/players/not-an-id/recent' })).statusCode).toBe(400);
    await app.close();
  });

  it('proxies the live patch list', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL) => Promise.resolve(new Response('[{"name":"7.41"},{"name":"7.41d"}]', { status: 200 })));
    const app = buildApp({ fetchImpl: fetchMock as unknown as typeof fetch });
    const res = await app.inject({ method: 'GET', url: '/opendota/patch' });
    expect(res.statusCode).toBe(200);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/constants/patch');
    await app.close();
  });

  it('locks CORS to the overlay origin', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL) => Promise.resolve(new Response(MATCH, { status: 200 })));
    const app = buildApp({ fetchImpl: fetchMock as unknown as typeof fetch });
    const res = await app.inject({ method: 'GET', url: '/opendota/match/123' });
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5273');
    await app.close();
  });
});
