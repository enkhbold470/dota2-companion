import type { FastifyInstance } from 'fastify';
import { callOpenAi } from './openai';

export interface CoachRouteOptions {
  apiKey: string | null;
  /** Live key lookup — lets the key be set at runtime via /settings without a restart. */
  getApiKey?: () => string | null;
  model?: string;
  fetchImpl?: typeof fetch;
  /**
   * Origin allowed to call /coach from a browser. Restricting this to the
   * overlay keeps arbitrary web pages from spending the OpenAI key: a
   * cross-origin JSON POST triggers a preflight, which fails for other origins.
   */
  allowOrigin?: string;
}

// The overlay is reachable at both loopback hostnames (Vite prints
// `localhost`, but users often type `127.0.0.1`). To a browser these are
// distinct origins, so we allow both — otherwise a `/coach` fetch from the
// other hostname fails CORS and shows "Coach unavailable". Still an allowlist,
// not `*`: a random web page can't spend the OpenAI key.
const DEFAULT_ALLOW_ORIGINS = ['http://127.0.0.1:5273', 'http://localhost:5273'];

const SYSTEM_PROMPT =
  'You are NeuroFocus Intelligence, a Dota 2 coach. Use the JSON game context (hero, clock, enemies, threat flags, deterministic item advice, tips). ' +
  'Answer in 2–4 sentences, 120 words max: the single most important action right now, why it matters against THIS enemy lineup, and one follow-up condition to watch for. ' +
  'Be specific — name items, abilities, timings and map positions plainly. No preamble, no lists, no restating the question.';

export function registerCoachRoute(app: FastifyInstance, opts: CoachRouteOptions): void {
  // allowOrigin may be a comma-separated list (e.g. COACH_ALLOW_ORIGIN).
  const allowList = opts.allowOrigin
    ? opts.allowOrigin.split(',').map((s) => s.trim()).filter((s) => s !== '')
    : DEFAULT_ALLOW_ORIGINS;
  const primaryOrigin = allowList[0] ?? DEFAULT_ALLOW_ORIGINS[0]!;
  // Echo the caller's origin when it's allowed (so both loopback hostnames
  // work); otherwise return the primary, which the browser will reject anyway.
  const resolveOrigin = (origin: unknown): string =>
    typeof origin === 'string' && allowList.includes(origin) ? origin : primaryOrigin;

  app.options('/coach', async (req, reply) => {
    return reply
      .code(204)
      .header('access-control-allow-origin', resolveOrigin(req.headers.origin))
      .header('access-control-allow-methods', 'POST')
      .header('access-control-allow-headers', 'content-type')
      .header('vary', 'origin')
      .send();
  });

  app.post('/coach', async (req, reply) => {
    reply.header('access-control-allow-origin', resolveOrigin(req.headers.origin));
    reply.header('vary', 'origin');

    const raw = req.body;
    const body = (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
      ? (raw as { question?: unknown; context?: unknown })
      : {};
    const question = body.question;
    if (typeof question !== 'string' || question.trim() === '' || question.length > 500) {
      return reply.code(400).send({ error: 'bad-question' });
    }
    const apiKey = opts.getApiKey ? opts.getApiKey() : opts.apiKey;
    if (!apiKey) {
      return reply.code(501).send({ error: 'no-key' });
    }

    const result = await callOpenAi({
      apiKey,
      model: opts.model,
      instructions: SYSTEM_PROMPT,
      input: `${question}\n\nContext:\n${JSON.stringify(body.context ?? null).slice(0, 12_000)}`,
      reasoningEffort: 'medium',
      maxOutputTokens: 1500,
      timeoutMs: 25_000,
      fetchImpl: opts.fetchImpl,
    });
    if (!result.ok) {
      console.error(`[coach] OpenAI request failed${result.status !== undefined ? ` (${result.status})` : ''} — check the API key/quota.`);
      return reply.code(502).send(
        result.status !== undefined ? { error: 'upstream', status: result.status } : { error: 'upstream' },
      );
    }
    return reply.code(200).send({ answer: result.text });
  });
}
