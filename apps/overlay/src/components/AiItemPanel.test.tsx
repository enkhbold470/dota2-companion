import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import type { ItemRecommendation } from '@dc/shared';
import { ITEM_DATA } from '@dc/shared';
import { AiItemPanel } from './AiItemPanel';

const jsonResponse = (status: number, body: unknown): Response =>
  ({ status, json: async () => body }) as Response;

afterEach(() => vi.unstubAllGlobals());

const baseProps = {
  getContext: () => ({ hero: { name: 'Zeus' } }),
  signature: 'zeus|core|1,2',
  ready: true,
  itemData: ITEM_DATA,
  gold: 6000,
  fallbackRecs: [] as ItemRecommendation[],
  hasEnemies: true,
  debounceMs: 0,
};

it('renders AI items with resolved icon, cost and BUY NOW', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    jsonResponse(200, { items: [{ name: 'Aether Lens', reason: 'range + mana' }] }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(<AiItemPanel {...baseProps} />);

  expect(await screen.findByText('Aether Lens')).toBeInTheDocument();
  expect(screen.getByText('range + mana')).toBeInTheDocument();
  // aether_lens costs less than 6000 → affordable badge
  expect(screen.getByText('BUY NOW')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:53000/item-build', expect.objectContaining({ method: 'POST' }));
});

it('falls back to the rule-based panel when the listener has no key', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(501, { error: 'no-key' }));
  vi.stubGlobal('fetch', fetchMock);
  const fallbackRecs: ItemRecommendation[] = [{
    itemKey: 'black_king_bar', itemName: 'Black King Bar', cost: 4050,
    affordable: true, score: 10, reasons: ['Blocks Lion Hex'], category: 'defensive',
  }];
  render(<AiItemPanel {...baseProps} fallbackRecs={fallbackRecs} />);

  expect(await screen.findByText(/Add OPENAI_API_KEY/)).toBeInTheDocument();
  expect(screen.getByText('Black King Bar')).toBeInTheDocument();
});

it('waits for the hero before calling the coach', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<AiItemPanel {...baseProps} ready={false} />);
  await waitFor(() => expect(screen.getByText('Waiting for your hero…')).toBeInTheDocument());
  expect(fetchMock).not.toHaveBeenCalled();
});
