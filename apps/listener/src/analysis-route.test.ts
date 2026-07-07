import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAnalysisRoute, type AnalysisRouteOptions } from './analysis-route';

function buildApp(opts: AnalysisRouteOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  registerAnalysisRoute(app, opts);
  return app;
}

const ANALYSIS = {
  summary: 'Solid first half, tilt after the 24-minute double death.',
  moments: [{ t: 1440, title: 'Post-death tilt spiral', insight: 'Two deaths in 40s; focus fell 68→31.' }],
  tiltPattern: 'Tilts on repeat deaths, recovers on kills.',
  recommendation: 'Take one deep breath during each death timer.',
};

function okAnalysis(): Response {
  return new Response(
    JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(ANALYSIS) }] }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const CONTEXT = { matchId: '812', durationSec: 1800, stats: {}, buckets: [], events: [] };

describe('analysis route', () => {
  it('returns 400 for a missing context and 501 without a key', async () => {
    const app = buildApp({ apiKey: 'sk-test' });
    expect((await app.inject({ method: 'POST', url: '/analysis', payload: {} })).statusCode).toBe(400);
    await app.close();
    const noKey = buildApp({ apiKey: null });
    expect((await noKey.inject({ method: 'POST', url: '/analysis', payload: { context: CONTEXT } })).statusCode).toBe(501);
    await noKey.close();
  });

  it('sends the session record with a strict schema and returns the parsed analysis', async () => {
    const fetchMock = vi.fn((_i: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(okAnalysis()));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    const res = await app.inject({ method: 'POST', url: '/analysis', payload: { context: CONTEXT } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(ANALYSIS);

    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      model: string; instructions: string; input: string;
      text?: { format?: { type?: string; name?: string } };
      reasoning?: { effort?: string };
    };
    expect(sent.model).toBe('gpt-5.4');
    expect(sent.instructions).toContain('NeuroFocus Intelligence');
    expect(sent.input).toContain('"matchId":"812"');
    expect(sent.text?.format?.type).toBe('json_schema');
    expect(sent.text?.format?.name).toBe('focus_analysis');
    expect(sent.reasoning?.effort).toBe('medium');
    await app.close();
  });

  it('maps upstream failures to 502', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('nope', { status: 500 })));
    const app = buildApp({ apiKey: 'sk-test', fetchImpl: fetchMock as unknown as typeof fetch });
    const res = await app.inject({ method: 'POST', url: '/analysis', payload: { context: CONTEXT } });
    expect(res.statusCode).toBe(502);
    await app.close();
  });

  it('locks CORS to the overlay origin on preflight', async () => {
    const app = buildApp({ apiKey: null });
    const res = await app.inject({ method: 'OPTIONS', url: '/analysis' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5273');
    await app.close();
  });
});
