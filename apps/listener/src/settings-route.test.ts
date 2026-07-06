import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerSettingsRoute } from './settings-route';

function buildApp(): { app: FastifyInstance; state: { key: string | null; saved: string[] } } {
  const state = { key: null as string | null, saved: [] as string[] };
  const app = Fastify({ logger: false });
  registerSettingsRoute(app, {
    getStatus: () => ({ openaiKeySet: !!state.key }),
    setOpenAiKey: (key) => { state.key = key === '' ? null : key; state.saved.push(key); },
  });
  return { app, state };
}

describe('settings route', () => {
  it('reports no key configured initially', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'GET', url: '/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ openaiKeySet: false });
    await app.close();
  });

  it('saves a well-formed key and then reports it configured', async () => {
    const { app, state } = buildApp();
    const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';
    const res = await app.inject({ method: 'POST', url: '/settings/openai-key', payload: { key } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ openaiKeySet: true });
    expect(state.key).toBe(key);

    const status = await app.inject({ method: 'GET', url: '/settings' });
    expect(status.json()).toEqual({ openaiKeySet: true });
    await app.close();
  });

  it('rejects an obviously invalid key without persisting it', async () => {
    const { app, state } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/settings/openai-key', payload: { key: 'nope' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-key' });
    expect(state.saved).toEqual([]);
    await app.close();
  });

  it('clears the key on an empty string', async () => {
    const { app, state } = buildApp();
    state.key = 'sk-existing';
    const res = await app.inject({ method: 'POST', url: '/settings/openai-key', payload: { key: '' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ openaiKeySet: false });
    expect(state.key).toBeNull();
    await app.close();
  });

  it('locks CORS to the overlay origin on preflight', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'OPTIONS', url: '/settings/openai-key' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5273');
    await app.close();
  });
});
