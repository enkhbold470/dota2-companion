import { describe, it, expect, vi } from 'vitest';
import { callOpenAi, extractOutputText, OPENAI_MODEL, RESPONSES_URL } from './openai';

function responsesPayload(output: unknown, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ output, ...extra }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('extractOutputText', () => {
  it('reads a single message output', () => {
    expect(extractOutputText({
      output: [{ type: 'message', content: [{ type: 'output_text', text: ' hello ' }] }],
    })).toBe('hello');
  });

  it('skips reasoning items and concatenates across messages', () => {
    expect(extractOutputText({
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: 'part one' }] },
        { type: 'message', content: [{ type: 'refusal', refusal: 'no' }, { type: 'output_text', text: ' part two' }] },
      ],
    })).toBe('part one part two');
  });

  it('returns empty string for missing/malformed output', () => {
    expect(extractOutputText(null)).toBe('');
    expect(extractOutputText({})).toBe('');
    expect(extractOutputText({ output: 'nope' })).toBe('');
    expect(extractOutputText({ output: [{ type: 'message', content: 'nope' }] })).toBe('');
  });
});

describe('callOpenAi', () => {
  it('POSTs the Responses API shape and returns aggregated text', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(responsesPayload([
        { type: 'message', content: [{ type: 'output_text', text: 'answer' }] },
      ])));
    const result = await callOpenAi({
      apiKey: 'sk-test',
      instructions: 'be brief',
      input: 'question',
      reasoningEffort: 'low',
      maxOutputTokens: 500,
      textFormat: { type: 'json_object' },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true, text: 'answer' });

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe(RESPONSES_URL);
    const headers = init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-test');
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(sent.model).toBe(OPENAI_MODEL);
    expect(sent.instructions).toBe('be brief');
    expect(sent.input).toBe('question');
    expect(sent.reasoning).toEqual({ effort: 'low' });
    expect(sent.max_output_tokens).toBe(500);
    expect(sent.text).toEqual({ format: { type: 'json_object' } });
    expect('temperature' in sent).toBe(false);
  });

  it('still returns text from an incomplete response', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(responsesPayload(
      [{ type: 'message', content: [{ type: 'output_text', text: 'partial' }] }],
      { status: 'incomplete' },
    )));
    const result = await callOpenAi({
      apiKey: 'sk-test', instructions: 'x', input: 'y',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true, text: 'partial' });
  });

  it('maps non-OK to upstream with status', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('nope', { status: 429 })));
    const result = await callOpenAi({
      apiKey: 'sk-test', instructions: 'x', input: 'y',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, status: 429, error: 'upstream' });
  });

  it('maps a rejected fetch to upstream without status', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network down')));
    const result = await callOpenAi({
      apiKey: 'sk-test', instructions: 'x', input: 'y',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, error: 'upstream' });
  });

  it('maps an empty output to the empty error', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(responsesPayload([])));
    const result = await callOpenAi({
      apiKey: 'sk-test', instructions: 'x', input: 'y',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, error: 'empty' });
  });
});
