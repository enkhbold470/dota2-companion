import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerVisionRoute, type VisionRouteOptions } from './vision-route';

function buildApp(opts: VisionRouteOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 8_000_000 });
  registerVisionRoute(app, opts);
  return app;
}

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';

function okHeroes(heroes: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ heroes }) } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('vision route', () => {
  it('rejects a non-image or missing payload with 400', async () => {
    const app = buildApp({ apiKey: 'sk-test' });
    const res = await app.inject({ method: 'POST', url: '/vision', payload: { image: 'not-an-image' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-image' });
    await app.close();
  });

  it('returns 501 no-key when the image is valid but no key is set', async () => {
    const app = buildApp({ apiKey: null });
    const res = await app.inject({ method: 'POST', url: '/vision', payload: { image: TINY_PNG } });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ error: 'no-key' });
    await app.close();
  });

  it('sends the image to OpenAI and returns parsed hero names', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(okHeroes(['Lion', 'Lina', '', 'Sven'])));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    const res = await app.inject({ method: 'POST', url: '/vision', payload: { image: TINY_PNG } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ heroes: ['Lion', 'Lina', 'Sven'] });

    const init = fetchMock.mock.calls[0]?.[1];
    const sent = JSON.parse(String(init?.body)) as {
      model?: string;
      messages?: { role: string; content: unknown }[];
    };
    expect(sent.model).toBe('gpt-4o');
    // the image data URL rides along in the user message content
    expect(JSON.stringify(sent.messages?.[1]?.content)).toContain('data:image/png');
    await app.close();
  });

  it('returns 502 when OpenAI responds non-OK', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('nope', { status: 500 })));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    const res = await app.inject({ method: 'POST', url: '/vision', payload: { image: TINY_PNG } });
    expect(res.statusCode).toBe(502);
    await app.close();
  });

  it('draft mode returns heroes split by side and uses the draft prompt', async () => {
    const draftResponse = new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        radiant: ['Lion', 'Sven'], dire: ['Anti-Mage', 'Tiny', ''],
      }) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    const fetchMock = vi.fn((_i: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(draftResponse));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    const res = await app.inject({ method: 'POST', url: '/vision', payload: { image: TINY_PNG, mode: 'draft' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ radiant: ['Lion', 'Sven'], dire: ['Anti-Mage', 'Tiny'] });

    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { messages?: { content: unknown }[] };
    expect(String(sent.messages?.[0]?.content)).toContain('split by team');
    await app.close();
  });

  it('draft mode still rejects a bad image and honors no-key', async () => {
    const noKey = buildApp({ apiKey: null });
    expect((await noKey.inject({ method: 'POST', url: '/vision', payload: { image: TINY_PNG, mode: 'draft' } })).statusCode).toBe(501);
    await noKey.close();
  });
});
