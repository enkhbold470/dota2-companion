/**
 * Shared OpenAI Responses API client (NeuroFocus Intelligence backend).
 * Every LLM route goes through callOpenAi so model/params/error handling
 * stay consistent and tests can assert one request shape.
 */

export const OPENAI_MODEL = 'gpt-5.4';
export const RESPONSES_URL = 'https://api.openai.com/v1/responses';

export type ImageDetail = 'low' | 'high' | 'original';

export type ResponsesInput =
  | string
  | {
      role: 'user';
      content: (
        | { type: 'input_text'; text: string }
        | { type: 'input_image'; image_url: string; detail?: ImageDetail }
      )[];
    }[];

export type TextFormat =
  | { type: 'json_object' }
  | { type: 'json_schema'; name: string; schema: object; strict?: boolean };

export interface CallOpenAiOptions {
  apiKey: string;
  instructions: string;
  input: ResponsesInput;
  model?: string;
  /** Includes reasoning tokens on gpt-5.x — size generously. */
  maxOutputTokens?: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  textFormat?: TextFormat;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type CallOpenAiResult =
  | { ok: true; text: string }
  | { ok: false; status?: number; error: 'upstream' | 'empty' };

interface ResponsesOutputItem {
  type?: unknown;
  content?: { type?: unknown; text?: unknown }[];
}

/**
 * Aggregate every output_text part across message items. The output array is
 * NOT guaranteed to put text at output[0].content[0] (reasoning items and
 * multiple messages can interleave), so walk everything.
 */
export function extractOutputText(data: unknown): string {
  const output = (data as { output?: unknown })?.output;
  if (!Array.isArray(output)) return '';
  let text = '';
  for (const item of output as ResponsesOutputItem[]) {
    if (!item || item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part && part.type === 'output_text' && typeof part.text === 'string') {
        text += part.text;
      }
    }
  }
  return text.trim();
}

export async function callOpenAi(opts: CallOpenAiOptions): Promise<CallOpenAiResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    model: opts.model ?? OPENAI_MODEL,
    instructions: opts.instructions,
    input: opts.input,
  };
  if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort };
  if (opts.maxOutputTokens !== undefined) body.max_output_tokens = opts.maxOutputTokens;
  if (opts.textFormat) body.text = { format: opts.textFormat };

  try {
    const res = await doFetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: 'upstream' };
    }
    const data: unknown = await res.json();
    const text = extractOutputText(data);
    if (text === '') return { ok: false, error: 'empty' };
    return { ok: true, text };
  } catch {
    return { ok: false, error: 'upstream' };
  }
}
