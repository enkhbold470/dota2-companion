import { render, screen, waitFor } from '@testing-library/react';
import { vi, it, expect, afterEach } from 'vitest';
import { LastMatchPanel } from './LastMatchPanel';

afterEach(() => { vi.restoreAllMocks(); });

const MATCH = {
  match_id: 8000000001,
  duration: 2143,
  radiant_win: true,
  players: [
    {
      account_id: 52079950, player_slot: 2, hero_id: 22 /* Zeus */, level: 21,
      kills: 11, deaths: 4, assists: 17, last_hits: 180, denies: 9,
      gold_per_min: 512, xp_per_min: 640, hero_damage: 31450, tower_damage: 2100,
      hero_healing: 0, net_worth: 18200, item_0: 1 /* blink */,
    },
  ],
};

it('renders the player stat sheet from the OpenDota proxy', async () => {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(MATCH), { status: 200 }))));
  render(<LastMatchPanel matchId="8000000001" accountId="52079950" />);
  await waitFor(() => expect(screen.getByText('VICTORY')).toBeInTheDocument());
  expect(screen.getByText('Zeus')).toBeInTheDocument();
  expect(screen.getByText('11 / 4 / 17')).toBeInTheDocument();
  expect(screen.getByText('180 / 9')).toBeInTheDocument();
  expect(screen.getByText('512 / 640')).toBeInTheDocument();
  expect(screen.getByText('31.4k')).toBeInTheDocument(); // hero damage
});

it('explains anonymous match data when the player row is hidden', async () => {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ ...MATCH, players: [] }), { status: 200 }))));
  render(<LastMatchPanel matchId="8000000001" accountId="52079950" />);
  await waitFor(() => expect(screen.getByText(/anonymous match data/)).toBeInTheDocument());
});

it('prompts to play when there is no match yet', () => {
  render(<LastMatchPanel matchId={null} accountId={null} />);
  expect(screen.getByText(/Play a match to populate/)).toBeInTheDocument();
});
