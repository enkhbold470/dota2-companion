import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AskCoachPanel } from './AskCoachPanel';

const jsonResponse = (status: number, body: unknown): Response =>
  ({ status, json: async () => body }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

it('disables Ask until a question is typed', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<AskCoachPanel getContext={() => null} />);
  const button = screen.getByRole('button', { name: 'Ask' });
  expect(button).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox'), 'What now?');
  expect(button).toBeEnabled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('POSTs the question with context and renders the answer on 200', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { answer: 'Buy a BKB.' }));
  vi.stubGlobal('fetch', fetchMock);
  render(<AskCoachPanel getContext={() => ({ clock: 600 })} endpoint="http://127.0.0.1:53000/coach" />);
  await userEvent.type(screen.getByRole('textbox'), 'What should I buy?');
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(await screen.findByText('Buy a BKB.')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('http://127.0.0.1:53000/coach');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body as string)).toEqual({
    question: 'What should I buy?',
    context: { clock: 600 },
  });
});

it('shows Asking… and blocks double-submit while the request is pending', async () => {
  let resolveFetch!: (r: Response) => void;
  const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((r) => { resolveFetch = r; }));
  vi.stubGlobal('fetch', fetchMock);
  render(<AskCoachPanel getContext={() => null} />);
  await userEvent.type(screen.getByRole('textbox'), 'hello');
  const button = screen.getByRole('button', { name: 'Ask' });
  await userEvent.click(button);
  expect(await screen.findByText('Asking…')).toBeInTheDocument();
  expect(screen.getByRole('button')).toBeDisabled();
  await userEvent.click(screen.getByRole('button'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  resolveFetch(jsonResponse(200, { answer: 'ok' }));
  expect(await screen.findByText('ok')).toBeInTheDocument();
});

it('explains the missing API key on 501', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(501, { error: 'no-key' }));
  vi.stubGlobal('fetch', fetchMock);
  render(<AskCoachPanel getContext={() => null} />);
  await userEvent.type(screen.getByRole('textbox'), 'hi');
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(
    await screen.findByText('Set OPENAI_API_KEY on the listener to enable AI coaching (GPT-4o).'),
  ).toBeInTheDocument();
});

it('shows the unavailable message when fetch rejects', async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
  vi.stubGlobal('fetch', fetchMock);
  render(<AskCoachPanel getContext={() => null} />);
  await userEvent.type(screen.getByRole('textbox'), 'hi');
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(await screen.findByText('Coach unavailable — is the listener running?')).toBeInTheDocument();
});

it('points at the OpenAI key/quota on 502', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(502, { error: 'upstream' }));
  vi.stubGlobal('fetch', fetchMock);
  render(<AskCoachPanel getContext={() => null} />);
  await userEvent.type(screen.getByRole('textbox'), 'hi');
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(
    await screen.findByText('Coach upstream error — check the OpenAI key/quota on the listener.'),
  ).toBeInTheDocument();
});
