import type { FastifyInstance } from 'fastify';

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
  'You are a Dota 2 coach. Use the JSON game context. Answer in 1–2 sentences, 40 words max: the single most important action right now and a brief why. No preamble, no lists, no restating the question. Name items/abilities plainly.';

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[];
}

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

    const doFetch = opts.fetchImpl ?? fetch;
    try {
      const res = await doFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model ?? 'gpt-4o',
          temperature: 0.4,
          max_tokens: 220,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `${question}\n\nContext:\n${JSON.stringify(body.context ?? null).slice(0, 4000)}` },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.error(`[coach] OpenAI returned ${res.status} — check the API key/quota.`);
        return reply.code(502).send({ error: 'upstream', status: res.status });
      }
      const data = (await res.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content;
      const answer = typeof content === 'string' ? content.trim() : '';
      if (answer === '') {
        return reply.code(502).send({ error: 'upstream' });
      }
      return reply.code(200).send({ answer });
    } catch (err) {
      console.error(`[coach] OpenAI request failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return reply.code(502).send({ error: 'upstream' });
    }
  });
}
