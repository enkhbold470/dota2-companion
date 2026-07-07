import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * Read-only proxy to the public OpenDota REST API for the Studio dashboard.
 * The overlay never talks to opendota.com directly: keeping the fetch here
 * gives one CORS story (locked to the overlay origin like the LLM routes) and
 * lets us cache — matches are immutable, so each match id is fetched from
 * OpenDota at most once ever (memory LRU + disk).
 */

export interface OpenDotaRouteOptions {
  fetchImpl?: typeof fetch;
  allowOrigin?: string;
  /** Disk cache home for immutable match JSON ({dir}/od-cache/). */
  cacheDir?: string;
  baseUrl?: string; // test seam
}

const DEFAULT_ALLOW_ORIGINS = ['http://127.0.0.1:5273', 'http://localhost:5273'];
const OPENDOTA = 'https://api.opendota.com/api';
const MATCH_LRU_MAX = 20;
const RECENT_TTL_MS = 5 * 60_000;
const PATCH_TTL_MS = 24 * 60 * 60_000;

interface TtlEntry { at: number; body: string }

export function registerOpenDotaRoute(app: FastifyInstance, opts: OpenDotaRouteOptions = {}): void {
  const allowList = opts.allowOrigin
    ? opts.allowOrigin.split(',').map((s) => s.trim()).filter((s) => s !== '')
    : DEFAULT_ALLOW_ORIGINS;
  const primaryOrigin = allowList[0] ?? DEFAULT_ALLOW_ORIGINS[0]!;
  const resolveOrigin = (origin: unknown): string =>
    typeof origin === 'string' && allowList.includes(origin) ? origin : primaryOrigin;
  const base = opts.baseUrl ?? OPENDOTA;
  const doFetch = opts.fetchImpl ?? fetch;

  const matchLru = new Map<string, string>();           // matchId → body (insertion order = recency)
  const ttlCache = new Map<string, TtlEntry>();         // url → body with TTL
  const inFlight = new Map<string, Promise<{ ok: boolean; status?: number; body?: string }>>();

  const fetchUpstream = (url: string): Promise<{ ok: boolean; status?: number; body?: string }> => {
    const pending = inFlight.get(url);
    if (pending) return pending;
    const p = (async () => {
      try {
        const res = await doFetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return { ok: false, status: res.status };
        return { ok: true, body: await res.text() };
      } catch {
        return { ok: false };
      } finally {
        inFlight.delete(url);
      }
    })();
    inFlight.set(url, p);
    return p;
  };

  const cacheFile = (matchId: string): string | null =>
    opts.cacheDir ? join(opts.cacheDir, 'od-cache', `match-${matchId}.json`) : null;

  app.get<{ Params: { matchId: string } }>('/opendota/match/:matchId', async (req, reply) => {
    reply.header('access-control-allow-origin', resolveOrigin(req.headers.origin));
    reply.header('vary', 'origin');
    const { matchId } = req.params;
    if (!/^\d{1,19}$/.test(matchId)) return reply.code(400).send({ error: 'bad-match-id' });

    const cached = matchLru.get(matchId);
    if (cached !== undefined) {
      matchLru.delete(matchId);
      matchLru.set(matchId, cached); // refresh recency
      return reply.code(200).type('application/json').send(cached);
    }
    const file = cacheFile(matchId);
    if (file) {
      try {
        const body = await readFile(file, 'utf8');
        matchLru.set(matchId, body);
        return reply.code(200).type('application/json').send(body);
      } catch { /* not on disk yet */ }
    }

    const res = await fetchUpstream(`${base}/matches/${matchId}`);
    if (!res.ok || res.body === undefined) {
      return reply.code(502).send(
        res.status !== undefined ? { error: 'upstream', status: res.status } : { error: 'upstream' },
      );
    }
    // Only cache real match payloads (OpenDota 200s an {"error":...} sometimes).
    let valid = false;
    try { valid = typeof (JSON.parse(res.body) as { match_id?: unknown }).match_id === 'number'; } catch { /* not JSON */ }
    if (valid) {
      matchLru.set(matchId, res.body);
      while (matchLru.size > MATCH_LRU_MAX) {
        const oldest = matchLru.keys().next().value;
        if (oldest === undefined) break;
        matchLru.delete(oldest);
      }
      if (file) {
        try {
          await mkdir(join(opts.cacheDir!, 'od-cache'), { recursive: true });
          await writeFile(file, res.body);
        } catch { /* disk cache is best-effort */ }
      }
    }
    return reply.code(200).type('application/json').send(res.body);
  });

  const ttlRoute = (routeUrl: string, upstream: (params: Record<string, string>) => string | null, ttlMs: number): void => {
    app.get(routeUrl, async (req, reply) => {
      reply.header('access-control-allow-origin', resolveOrigin(req.headers.origin));
      reply.header('vary', 'origin');
      const target = upstream(req.params as Record<string, string>);
      if (!target) return reply.code(400).send({ error: 'bad-request' });
      const hit = ttlCache.get(target);
      if (hit && Date.now() - hit.at < ttlMs) {
        return reply.code(200).type('application/json').send(hit.body);
      }
      const res = await fetchUpstream(target);
      if (!res.ok || res.body === undefined) {
        // Serve a stale hit over an error — better a 5-minute-old table than none.
        if (hit) return reply.code(200).type('application/json').send(hit.body);
        return reply.code(502).send(
          res.status !== undefined ? { error: 'upstream', status: res.status } : { error: 'upstream' },
        );
      }
      ttlCache.set(target, { at: Date.now(), body: res.body });
      return reply.code(200).type('application/json').send(res.body);
    });
  };

  ttlRoute('/opendota/players/:accountId/recent', (p) =>
    /^\d{1,12}$/.test(p.accountId ?? '') ? `${base}/players/${p.accountId}/recentMatches` : null, RECENT_TTL_MS);

  ttlRoute('/opendota/patch', () => `${base}/constants/patch`, PATCH_TTL_MS);
}
