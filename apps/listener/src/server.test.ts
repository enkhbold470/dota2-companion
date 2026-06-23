import { describe, it, expect } from 'vitest';
import { buildServer } from './server';
import { Hub } from './hub';

const payload = {
  auth: { token: 'secret' },
  map: { matchid: '42', clock_time: 120, daytime: true, game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' },
  player: { gpm: 500 },
  hero: { id: 5 },
  items: {},
};

describe('listener server', () => {
  it('accepts an authorized GSI POST and updates the hub', async () => {
    const hub = new Hub();
    const app = buildServer({ token: 'secret', hub });
    const res = await app.inject({ method: 'POST', url: '/', payload });
    expect(res.statusCode).toBe(200);
    expect(hub.getLatest()?.matchId).toBe('42');
    await app.close();
  });

  it('rejects an unauthorized POST with 401 and does not update', async () => {
    const hub = new Hub();
    const app = buildServer({ token: 'secret', hub });
    const res = await app.inject({ method: 'POST', url: '/', payload: { ...payload, auth: { token: 'wrong' } } });
    expect(res.statusCode).toBe(401);
    expect(hub.getLatest()).toBeNull();
    await app.close();
  });

  it('serves /health', async () => {
    const app = buildServer({ token: 'secret', hub: new Hub() });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
