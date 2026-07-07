import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerItemRoute, type ItemRouteOptions } from './item-route';

function buildApp(opts: ItemRouteOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  registerItemRoute(app, opts);
  return app;
}

function okItems(items: unknown): Response {
  return new Response(
    JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ items }) }] }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('item-build route', () => {
  it('returns 501 no-key when no api key is configured', async () => {
    const app = buildApp({ apiKey: null });
    const res = await app.inject({ method: 'POST', url: '/item-build', payload: { context: {} } });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ error: 'no-key' });
    await app.close();
  });

  it('returns a parsed, capped item list on the happy path, asking for JSON', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(okItems([
        { name: 'Aether Lens', reason: 'range + mana' },
        { name: '', reason: 'dropped — no name' },
        { name: 'Octarine Core', reason: 'cooldowns' },
      ])));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    const res = await app.inject({
      method: 'POST', url: '/item-build',
      payload: { context: { hero: { name: 'Zeus' }, enemies: ['Lion'] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [
      { name: 'Aether Lens', reason: 'range + mana' },
      { name: 'Octarine Core', reason: 'cooldowns' },
    ] });

    const init = fetchMock.mock.calls[0]?.[1];
    const sent = JSON.parse(String(init?.body)) as {
      text?: { format?: { type?: string } }; model?: string; reasoning?: { effort?: string };
    };
    expect(sent.text?.format?.type).toBe('json_object');
    expect(sent.model).toBe('gpt-5.4');
    expect(sent.reasoning?.effort).toBe('low');
    await app.close();
  });

  it('passes the fun build style into the system prompt', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(okItems([{ name: 'Dagon', reason: 'delete them' }])));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    const res = await app.inject({
      method: 'POST', url: '/item-build',
      payload: { context: { hero: { name: 'Zeus' } }, style: 'fun' },
    });
    expect(res.statusCode).toBe(200);
    const init = fetchMock.mock.calls[0]?.[1];
    const sent = JSON.parse(String(init?.body)) as { instructions: string };
    expect(sent.instructions).toContain('BUILD STYLE = FUN');
    await app.close();
  });

  it('fun style with a known hero id injects that hero\'s curated pool, not the generic list', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(okItems([{ name: 'Ethereal Blade', reason: 'mana void combo' }])));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    // Hero id 1 = Anti-Mage, present in hero-builds.json.
    await app.inject({
      method: 'POST', url: '/item-build',
      payload: { context: { hero: { id: 1, name: 'Anti-Mage' } }, style: 'fun' },
    });
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { instructions: string };
    expect(sent.instructions).toContain('Curated fun pool for THIS hero');
    // The old one-list-for-every-hero prompt is gone for known heroes.
    expect(sent.instructions).not.toContain('big magic burst (Dagon');
    await app.close();
  });

  it('meta style tells the model to weigh the deterministic engine recs', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(okItems([{ name: 'Black King Bar', reason: 'safe' }])));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    await app.inject({ method: 'POST', url: '/item-build', payload: { context: {}, style: 'meta' } });
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { instructions: string };
    expect(sent.instructions).toContain('engineRecs');
    await app.close();
  });

  it('defaults to the meta build style when none is given', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(okItems([{ name: 'Black King Bar', reason: 'safe' }])));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    await app.inject({ method: 'POST', url: '/item-build', payload: { context: {} } });
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { instructions: string };
    expect(sent.instructions).toContain('BUILD STYLE = META');
    await app.close();
  });

  it('returns 502 when OpenAI responds non-OK', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('nope', { status: 429 })));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    const res = await app.inject({ method: 'POST', url: '/item-build', payload: { context: {} } });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'upstream', status: 429 });
    await app.close();
  });

  it('locks CORS to the overlay origin on preflight', async () => {
    const app = buildApp({ apiKey: null });
    const res = await app.inject({ method: 'OPTIONS', url: '/item-build' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5273');
    await app.close();
  });
});
