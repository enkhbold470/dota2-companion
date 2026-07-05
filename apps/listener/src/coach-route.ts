import type { FastifyInstance } from 'fastify';

export interface CoachRouteOptions {
  apiKey: string | null;
  model?: string;
  fetchImpl?: typeof fetch;
}

const SYSTEM_PROMPT =
  'You are a concise Dota 2 coach. Use the JSON game context. Give one actionable answer in under 120 words. Cite item/ability names plainly.';

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[];
}

export function registerCoachRoute(app: FastifyInstance, opts: CoachRouteOptions): void {
  app.options('/coach', async (_req, reply) => {
    return reply
      .code(204)
      .header('access-control-allow-origin', '*')
      .header('access-control-allow-methods', 'POST')
      .header('access-control-allow-headers', 'content-type')
      .send();
  });

  app.post('/coach', async (req, reply) => {
    reply.header('access-control-allow-origin', '*');

    const raw = req.body;
    const body = (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
      ? (raw as { question?: unknown; context?: unknown })
      : {};
    const question = body.question;
    if (typeof question !== 'string' || question.trim() === '' || question.length > 500) {
      return reply.code(400).send({ error: 'bad-question' });
    }
    if (!opts.apiKey) {
      return reply.code(501).send({ error: 'no-key' });
    }

    const doFetch = opts.fetchImpl ?? fetch;
    try {
      const res = await doFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey}`,
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
        return reply.code(502).send({ error: 'upstream' });
      }
      const data = (await res.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content;
      const answer = typeof content === 'string' ? content.trim() : '';
      if (answer === '') {
        return reply.code(502).send({ error: 'upstream' });
      }
      return reply.code(200).send({ answer });
    } catch {
      return reply.code(502).send({ error: 'upstream' });
    }
  });
}
