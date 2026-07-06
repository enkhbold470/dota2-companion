import type { FastifyInstance } from 'fastify';

export interface ItemRouteOptions {
  apiKey: string | null;
  model?: string;
  fetchImpl?: typeof fetch;
  allowOrigin?: string;
}

const DEFAULT_ALLOW_ORIGINS = ['http://127.0.0.1:5273', 'http://localhost:5273'];

const SYSTEM_PROMPT =
  'You are a Dota 2 item-build coach. From the JSON game context (your hero, level, gold, current items, role, enemy heroes, clock) recommend the next items to buy — specific to THIS hero and THIS enemy lineup, not generic. ' +
  'Return JSON only: {"items":[{"name":"Exact In-Game Item Name","reason":"<=10 words why now"}]}. ' +
  '3 to 5 items, highest priority first. Skip items already owned. ' +
  'If the context has hasScepter=true the player already has the Aghanim\'s Scepter upgrade — never recommend it (or "Aghanim\'s Blessing"). If hasShard=true, never recommend Aghanim\'s Shard. ' +
  'Recommend only buyable shop items — use "Aghanim\'s Scepter", never the Roshan-only "Aghanim\'s Blessing". ' +
  'Weight the immediate pickup toward the gold available. Use exact item names, e.g. "Black King Bar", "Aether Lens", "Boots of Travel".';

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[];
}

interface ItemSuggestion {
  name: string;
  reason: string;
}

function parseItems(content: unknown): ItemSuggestion[] {
  if (typeof content !== 'string') return [];
  try {
    const obj: unknown = JSON.parse(content);
    const arr = obj && typeof obj === 'object' && Array.isArray((obj as { items?: unknown }).items)
      ? (obj as { items: unknown[] }).items
      : [];
    return arr
      .map((x): ItemSuggestion => {
        const o = (x && typeof x === 'object' ? x : {}) as { name?: unknown; reason?: unknown };
        return {
          name: typeof o.name === 'string' ? o.name : '',
          reason: typeof o.reason === 'string' ? o.reason : '',
        };
      })
      .filter((x) => x.name !== '')
      .slice(0, 6);
  } catch {
    return [];
  }
}

export function registerItemRoute(app: FastifyInstance, opts: ItemRouteOptions): void {
  const allowList = opts.allowOrigin
    ? opts.allowOrigin.split(',').map((s) => s.trim()).filter((s) => s !== '')
    : DEFAULT_ALLOW_ORIGINS;
  const primaryOrigin = allowList[0] ?? DEFAULT_ALLOW_ORIGINS[0]!;
  const resolveOrigin = (origin: unknown): string =>
    typeof origin === 'string' && allowList.includes(origin) ? origin : primaryOrigin;

  app.options('/item-build', async (req, reply) => {
    return reply
      .code(204)
      .header('access-control-allow-origin', resolveOrigin(req.headers.origin))
      .header('access-control-allow-methods', 'POST')
      .header('access-control-allow-headers', 'content-type')
      .header('vary', 'origin')
      .send();
  });

  app.post('/item-build', async (req, reply) => {
    reply.header('access-control-allow-origin', resolveOrigin(req.headers.origin));
    reply.header('vary', 'origin');

    const raw = req.body;
    const body = (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
      ? (raw as { context?: unknown; style?: unknown })
      : {};
    if (!opts.apiKey) {
      return reply.code(501).send({ error: 'no-key' });
    }
    const style = body.style === 'fun' ? 'fun' : 'meta';
    const styleLine = style === 'fun'
      ? 'BUILD STYLE = FUN: lean into high-impact, high-damage, spicy picks that are still castable on this hero — big magic burst (Dagon, Ethereal Blade, Shiva\'s Guard, Veil of Discord), big physical/crit (Daedalus, Radiance, Bloodthorn, Monkey King Bar), and greedy tempo (Refresher Orb, Octarine Core). Choose fun and aggressive over safe/defensive, but keep every item usable on the hero (caster vs carry, right attack type). Punchy reasons.'
      : 'BUILD STYLE = META: the optimal, highest-impact build for winning.';

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
          temperature: 0.3,
          max_tokens: 400,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${SYSTEM_PROMPT} ${styleLine}` },
            { role: 'user', content: `Context:\n${JSON.stringify(body.context ?? null).slice(0, 4000)}` },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        console.error(`[item-build] OpenAI returned ${res.status} — check the API key/quota.`);
        return reply.code(502).send({ error: 'upstream', status: res.status });
      }
      const data = (await res.json()) as ChatCompletionResponse;
      const items = parseItems(data.choices?.[0]?.message?.content);
      return reply.code(200).send({ items });
    } catch (err) {
      console.error(`[item-build] OpenAI request failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return reply.code(502).send({ error: 'upstream' });
    }
  });
}
