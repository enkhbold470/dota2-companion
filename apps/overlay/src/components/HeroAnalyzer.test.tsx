import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { HERO_DATA } from '@dc/shared';
import { HeroAnalyzer } from './HeroAnalyzer';

const jsonResponse = (status: number, body: unknown): Response =>
  ({ status, json: async () => body }) as Response;

const pngFile = () => new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });

afterEach(() => vi.unstubAllGlobals());

it('uploads an image, resolves hero names to ids, and reports them', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { heroes: ['Sven', 'Lion'] }));
  vi.stubGlobal('fetch', fetchMock);
  const onDetected = vi.fn();
  const { container } = render(<HeroAnalyzer heroData={HERO_DATA} onHeroesDetected={onDetected} />);

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [pngFile()] } });

  await waitFor(() => expect(onDetected).toHaveBeenCalled());
  const ids = onDetected.mock.calls[0][0] as number[];
  expect(ids.length).toBe(2);
  expect(await screen.findByText('Detected:')).toBeInTheDocument();
  expect(screen.getByText('Sven')).toBeInTheDocument();
});

it('shows the no-key hint on 501', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(501, { error: 'no-key' }));
  vi.stubGlobal('fetch', fetchMock);
  const { container } = render(<HeroAnalyzer heroData={HERO_DATA} onHeroesDetected={vi.fn()} />);

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [pngFile()] } });
  expect(await screen.findByText(/Add OPENAI_API_KEY/)).toBeInTheDocument();
});
