import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerCoachRoute, type CoachRouteOptions } from './coach-route';
import { buildServer } from './server';
import { Hub } from './hub';

function buildApp(opts: CoachRouteOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  registerCoachRoute(app, opts);
  return app;
}

function okCompletion(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('coach route', () => {
  it('returns 501 no-key when no api key is configured', async () => {
    const app = buildApp({ apiKey: null });
    const res = await app.inject({ method: 'POST', url: '/coach', payload: { question: 'What should I buy?' } });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ error: 'no-key' });
    await app.close();
  });

  it('returns 400 bad-question for an empty question', async () => {
    const app = buildApp({ apiKey: 'sk-test' });
    const res = await app.inject({ method: 'POST', url: '/coach', payload: { question: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-question' });
    await app.close();
  });

  it('returns 400 bad-question for an oversized question', async () => {
    const app = buildApp({ apiKey: 'sk-test' });
    const res = await app.inject({ method: 'POST', url: '/coach', payload: { question: 'x'.repeat(501) } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-question' });
    await app.close();
  });

  it('answers via the OpenAI API on the happy path', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(okCompletion('  Buy a Black King Bar next.  ')));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    const res = await app.inject({
      method: 'POST',
      url: '/coach',
      payload: { question: 'What should I buy?', context: { gold: 4200 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ answer: 'Buy a Black King Bar next.' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-test');
    const sent = JSON.parse(String(init?.body)) as {
      model: string; max_tokens: number; temperature: number;
      messages: { role: string; content: string }[];
    };
    expect(sent.model).toBe('gpt-4o');
    expect(sent.max_tokens).toBe(220);
    expect(sent.temperature).toBe(0.4);
    expect(sent.messages[1]?.content).toContain('What should I buy?');
    expect(sent.messages[1]?.content).toContain('"gold":4200');
    await app.close();
  });

  it('returns 502 upstream when the API responds non-OK', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('nope', { status: 500 })));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    const res = await app.inject({ method: 'POST', url: '/coach', payload: { question: 'Why did I die?' } });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'upstream', status: 500 });
    await app.close();
  });

  it('returns 502 upstream when fetch rejects', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.reject(new Error('network down')));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    const res = await app.inject({ method: 'POST', url: '/coach', payload: { question: 'Why did I die?' } });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'upstream' });
    await app.close();
  });

  it('handles the OPTIONS preflight with 204 and CORS locked to the overlay origin', async () => {
    const app = buildApp({ apiKey: null });
    const res = await app.inject({ method: 'OPTIONS', url: '/coach' });
    expect(res.statusCode).toBe(204);
    // Not '*': a random web page must fail preflight so it cannot spend the OpenAI key.
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5273');
    expect(res.headers['access-control-allow-methods']).toBe('POST');
    expect(res.headers['access-control-allow-headers']).toBe('content-type');
    await app.close();
  });

  it('sets access-control-allow-origin on POST responses and honors allowOrigin override', async () => {
    const app = buildApp({ apiKey: null });
    const res = await app.inject({ method: 'POST', url: '/coach', payload: { question: 'hi' } });
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5273');
    await app.close();

    const custom = buildApp({ apiKey: null, allowOrigin: 'http://localhost:9999' });
    const res2 = await custom.inject({ method: 'OPTIONS', url: '/coach' });
    expect(res2.headers['access-control-allow-origin']).toBe('http://localhost:9999');
    await custom.close();
  });

  it('is wired into buildServer via openaiKey', async () => {
    const app = buildServer({ token: 'secret', hub: new Hub() });
    const res = await app.inject({ method: 'POST', url: '/coach', payload: { question: 'hi' } });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ error: 'no-key' });
    await app.close();
  });
});
