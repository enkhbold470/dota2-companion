import type { FastifyInstance } from 'fastify';

export interface VisionRouteOptions {
  apiKey: string | null;
  /** Live key lookup — lets the key be set at runtime via /settings without a restart. */
  getApiKey?: () => string | null;
  model?: string;
  fetchImpl?: typeof fetch;
  allowOrigin?: string;
}

const DEFAULT_ALLOW_ORIGINS = ['http://127.0.0.1:5273', 'http://localhost:5273'];
const MAX_IMAGE_CHARS = 8_000_000; // generous data-URL cap

const SYSTEM_PROMPT =
  'You identify Dota 2 heroes in a screenshot (scoreboard, top hero bar, or draft). ' +
  'Return JSON only: {"heroes":["Official Hero Name", ...]} using exact English names, e.g. "Anti-Mage", "Queen of Pain", "Nature\'s Prophet". ' +
  'At most 5, each once, only heroes you can clearly see. If none are visible, return an empty array.';

function userInstruction(ownHero: string | null): string {
  if (!ownHero) return 'Identify every Dota 2 hero you can clearly see.';
  return (
    `The player plays ${ownHero}. Return ONLY the ENEMY heroes — the team opposing ${ownHero}. ` +
    "In Dota's top hero bar the two teams sit on opposite sides of the central clock/score; " +
    'in the scoreboard they are grouped as Radiant vs Dire. ' +
    `Never include ${ownHero} or ${ownHero}'s teammates. ` +
    `If you truly cannot tell the teams apart, return every hero except ${ownHero}.`
  );
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[];
}

function parseHeroes(content: unknown): string[] {
  if (typeof content !== 'string') return [];
  try {
    const obj: unknown = JSON.parse(content);
    const arr = obj && typeof obj === 'object' && Array.isArray((obj as { heroes?: unknown }).heroes)
      ? (obj as { heroes: unknown[] }).heroes
      : [];
    return arr.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 5);
  } catch {
    return [];
  }
}

export function registerVisionRoute(app: FastifyInstance, opts: VisionRouteOptions): void {
  const allowList = opts.allowOrigin
    ? opts.allowOrigin.split(',').map((s) => s.trim()).filter((s) => s !== '')
    : DEFAULT_ALLOW_ORIGINS;
  const primaryOrigin = allowList[0] ?? DEFAULT_ALLOW_ORIGINS[0]!;
  const resolveOrigin = (origin: unknown): string =>
    typeof origin === 'string' && allowList.includes(origin) ? origin : primaryOrigin;

  app.options('/vision', async (req, reply) => {
    return reply
      .code(204)
      .header('access-control-allow-origin', resolveOrigin(req.headers.origin))
      .header('access-control-allow-methods', 'POST')
      .header('access-control-allow-headers', 'content-type')
      .header('vary', 'origin')
      .send();
  });

  app.post('/vision', async (req, reply) => {
    reply.header('access-control-allow-origin', resolveOrigin(req.headers.origin));
    reply.header('vary', 'origin');

    const raw = req.body;
    const body = (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
      ? (raw as { image?: unknown; ownHero?: unknown })
      : {};
    const image = body.image;
    if (typeof image !== 'string' || !image.startsWith('data:image/') || image.length > MAX_IMAGE_CHARS) {
      return reply.code(400).send({ error: 'bad-image' });
    }
    const apiKey = opts.getApiKey ? opts.getApiKey() : opts.apiKey;
    if (!apiKey) {
      return reply.code(501).send({ error: 'no-key' });
    }
    const ownHero = typeof body.ownHero === 'string' && body.ownHero.trim() !== '' ? body.ownHero.trim() : null;

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
          temperature: 0,
          max_tokens: 200,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: userInstruction(ownHero) },
                { type: 'image_url', image_url: { url: image } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) {
        console.error(`[vision] OpenAI returned ${res.status} — check the API key/quota.`);
        return reply.code(502).send({ error: 'upstream', status: res.status });
      }
      const data = (await res.json()) as ChatCompletionResponse;
      const heroes = parseHeroes(data.choices?.[0]?.message?.content);
      return reply.code(200).send({ heroes });
    } catch (err) {
      console.error(`[vision] OpenAI request failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return reply.code(502).send({ error: 'upstream' });
    }
  });
}
