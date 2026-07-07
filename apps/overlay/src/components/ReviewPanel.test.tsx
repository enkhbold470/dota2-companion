import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ReviewPanel } from './ReviewPanel';

const jsonResponse = (status: number, body: unknown): Response =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

afterEach(() => vi.unstubAllGlobals());

const listing = {
  dir: '/tmp/x',
  sessions: [{
    name: 's.json', size: 100, mtimeMs: 1,
    head: {
      format: 'neurofocus_ble_eeg_v2', startedAtMs: 1_700_000_000_000, endedAtMs: 1_700_000_600_000,
      durationSec: 600, source: 'device', matchId: '42',
      video: { filename: 'v.webm', startedAtMs: 1_700_000_000_100 },
    },
  }],
  videos: [{ name: 'v.webm', size: 8, mtimeMs: 1 }],
};

const session = {
  format: 'neurofocus_ble_eeg_v2',
  startedAtMs: 1_700_000_000_000, endedAtMs: 1_700_000_600_000, durationSec: 600,
  matchId: '42',
  video: { filename: 'v.webm', startedAtMs: 1_700_000_000_100 },
  focus: [
    { t: 0, tMs: 1_700_000_000_000, focus: 60, stress: 40, state: 'FOCUSED', tilt: 0, quality: 3 },
    { t: 600, tMs: 1_700_000_600_000, focus: 55, stress: 45, state: 'FOCUSED', tilt: 0, quality: 3 },
  ],
  events: [{ t: 300, tMs: 1_700_000_300_000, kind: 'death' }],
  samples: [],
};

it('lists sessions, opens one, and shows the video + death moment chip', async () => {
  const fetchMock = vi.fn((url: RequestInfo | URL) =>
    Promise.resolve(String(url).includes('/recordings/file')
      ? jsonResponse(200, session)
      : jsonResponse(200, listing)));
  vi.stubGlobal('fetch', fetchMock);
  render(<ReviewPanel />);

  expect(await screen.findByText('match 42')).toBeInTheDocument();
  await userEvent.click(screen.getByText('match 42'));

  // Death at game clock 300 s → a seekable moment chip.
  expect(await screen.findByText('Death 5:00')).toBeInTheDocument();
  // The player points at the recording file route.
  const video = document.querySelector('video');
  expect(video).not.toBeNull();
  expect(video!.src).toContain('/recordings/file?name=v.webm');
});

it('explains when a session has no video recording', async () => {
  const noVideoSession = { ...session, video: null };
  const noVideoListing = {
    ...listing, videos: [],
    sessions: [{ ...listing.sessions[0]!, head: { ...listing.sessions[0]!.head, video: null } }],
  };
  const fetchMock = vi.fn((url: RequestInfo | URL) =>
    Promise.resolve(String(url).includes('/recordings/file')
      ? jsonResponse(200, noVideoSession)
      : jsonResponse(200, noVideoListing)));
  vi.stubGlobal('fetch', fetchMock);
  render(<ReviewPanel />);

  await userEvent.click(await screen.findByText('match 42'));
  expect(await screen.findByText(/No screen recording with this session/)).toBeInTheDocument();
  expect(document.querySelector('video')).toBeNull();
});

it('shows the empty state when nothing is recorded yet', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { dir: '/x', sessions: [], videos: [] })));
  render(<ReviewPanel />);
  expect(await screen.findByText(/No saved sessions yet/)).toBeInTheDocument();
});
