import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { HERO_DATA } from '@dc/shared';
import { AutoDraftBanner } from './AutoDraftBanner';
import type { AutoDraftResult } from '../eeg/useAutoDraft';

const base = (over: Partial<AutoDraftResult>): AutoDraftResult => ({
  status: 'idle', allies: [], armAndScan: vi.fn(), rescan: vi.fn(), ...over,
});

const svenId = Number(Object.entries(HERO_DATA).find(([, h]) => h.localizedName === 'Sven')![0]);

it('offers a one-click enable when capture is not armed', async () => {
  const armAndScan = vi.fn();
  render(<AutoDraftBanner auto={base({ status: 'need-arm', armAndScan })} allies={[]} heroData={HERO_DATA} team={null} />);
  const btn = screen.getByText('🎥 Enable auto-detect');
  await userEvent.click(btn);
  expect(armAndScan).toHaveBeenCalled();
});

it('shows a detected badge and the ally row when done', () => {
  render(<AutoDraftBanner auto={base({ status: 'done', allies: [svenId] })} allies={[svenId]} heroData={HERO_DATA} team="radiant" />);
  expect(screen.getByText('detected ✓')).toBeInTheDocument();
  expect(screen.getByText('Allies')).toBeInTheDocument();
  expect(screen.getByAltText('Sven')).toBeInTheDocument();
  expect(screen.getByText('radiant')).toBeInTheDocument();
});

it('points to manual pick when there is no OpenAI key', () => {
  render(<AutoDraftBanner auto={base({ status: 'no-key' })} allies={[]} heroData={HERO_DATA} team={null} />);
  expect(screen.getByText(/needs an OpenAI key/)).toBeInTheDocument();
});
