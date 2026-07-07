import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { HERO_DATA, type NormalizedState } from '@dc/shared';
import { useAutoDraft } from './useAutoDraft';

const RADIANT = ['Sven', 'Lion', 'Zeus', 'Axe', 'Lina'];
const DIRE = ['Anti-Mage', 'Tiny', 'Crystal Maiden', 'Ogre Magi', 'Juggernaut'];

function gameState(over: Partial<NormalizedState> = {}): NormalizedState {
  return {
    matchId: 'm1', phase: 'strategy', team: 'radiant', clock: -60,
    hero: { id: 18 /* Sven */ },
    ...over,
  } as NormalizedState;
}

function draftResponse(dire: string[]): Response {
  return new Response(JSON.stringify({ radiant: RADIANT, dire }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

function makeDeps(over: Record<string, unknown> = {}) {
  return {
    captureArmed: true,
    armCapture: vi.fn(() => Promise.resolve()),
    grabFrame: vi.fn(() => Promise.resolve('data:image/jpeg;base64,xxx')),
    onEnemies: vi.fn(),
    enemiesManual: false,
    heroData: HERO_DATA,
    ...over,
  };
}

describe('useAutoDraft retry policy', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('grabs the cropped draft-bar frame', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(draftResponse(DIRE)));
    vi.stubGlobal('fetch', fetchMock);
    const deps = makeDeps();
    const { result } = renderHook(() => useAutoDraft(gameState(), deps));
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(deps.grabFrame).toHaveBeenCalledWith('draftBar');
    expect(result.current.status).toBe('done');
    expect(deps.onEnemies).toHaveBeenCalledTimes(1);
  });

  it('retries a failed scan and gives up after the attempt budget', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('nope', { status: 502 })));
    vi.stubGlobal('fetch', fetchMock);
    const deps = makeDeps();
    const { result } = renderHook(() => useAutoDraft(gameState(), deps));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.status).toBe('retrying');
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(result.current.status).toBe('retrying');
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(result.current.status).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('applies a partial read immediately but keeps retrying, never downgrading', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(draftResponse(DIRE.slice(0, 3)))
      .mockResolvedValueOnce(draftResponse(DIRE));
    vi.stubGlobal('fetch', fetchMock);
    const deps = makeDeps();
    const { result } = renderHook(() => useAutoDraft(gameState(), deps));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.status).toBe('retrying');
    expect(deps.onEnemies).toHaveBeenLastCalledWith(expect.arrayContaining([]));
    expect((deps.onEnemies.mock.lastCall?.[0] as number[]).length).toBe(3);

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(result.current.status).toBe('done');
    expect((deps.onEnemies.mock.lastCall?.[0] as number[]).length).toBe(5);
  });

  it('does not retry on no-key', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 501 })));
    vi.stubGlobal('fetch', fetchMock);
    const deps = makeDeps();
    const { result } = renderHook(() => useAutoDraft(gameState(), deps));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(result.current.status).toBe('no-key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never scans when the user picked enemies manually', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const deps = makeDeps({ enemiesManual: true });
    renderHook(() => useAutoDraft(gameState(), deps));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
