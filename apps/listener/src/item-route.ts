import type { FastifyInstance } from 'fastify';
import { HERO_BUILDS } from '@dc/shared';
import { callOpenAi, type TextFormat } from './openai';

export interface ItemRouteOptions {
  apiKey: string | null;
  /** Live key lookup — lets the key be set at runtime via /settings without a restart. */
  getApiKey?: () => string | null;
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

const META_STYLE_LINE =
  'BUILD STYLE = META: the optimal, highest-impact build for winning. ' +
  'The context may include engineRecs (a deterministic counter-item engine\'s picks with reasons) — agree with them or override with better reasons, don\'t ignore them.';

// Generic fallback only when the hero id is unknown; with a known hero the
// curated per-hero pool (hero-builds.json) drives the fun style instead.
const GENERIC_FUN_LINE =
  'BUILD STYLE = FUN: lean into high-impact, high-damage, spicy picks that are still castable on this hero — big magic burst, big physical/crit, greedy tempo. ' +
  'Choose fun and aggressive over safe/defensive, but keep every item usable on the hero (caster vs carry, right attack type). Punchy reasons.';

/** Fun style: anchor the model on this hero's curated pool, adapted to the live game. */
function funStyleLine(context: unknown): string {
  const heroId = (context as { hero?: { id?: unknown } } | null | undefined)?.hero?.id;
  const pool = typeof heroId === 'number' ? HERO_BUILDS[String(heroId)]?.fun : undefined;
  if (!pool || pool.length === 0) return GENERIC_FUN_LINE;
  const poolText = pool.map((p) => `${p.name} (${p.why})`).join('; ');
  return (
    'BUILD STYLE = FUN. Curated fun pool for THIS hero — draw mostly from it, picking what fits the enemies, gold and game time; ' +
    `you may swap in something spicier when the lineup begs for it: ${poolText}. Punchy reasons.`
  );
}

// Strict schema instead of free json_object mode: guaranteed shape, and the
// Responses API doesn't demand the word "json" in the input for schema'd formats.
const ITEMS_SCHEMA: TextFormat = {
  type: 'json_schema',
  name: 'item_build',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        minItems: 3,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Exact in-game item name' },
            reason: { type: 'string', description: '<=10 words why now' },
          },
          required: ['name', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

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
    const apiKey = opts.getApiKey ? opts.getApiKey() : opts.apiKey;
    if (!apiKey) {
      return reply.code(501).send({ error: 'no-key' });
    }
    const style = body.style === 'fun' ? 'fun' : 'meta';
    const styleLine = style === 'fun' ? funStyleLine(body.context) : META_STYLE_LINE;

    const result = await callOpenAi({
      apiKey,
      model: opts.model,
      instructions: `${SYSTEM_PROMPT} ${styleLine}`,
      input: `Context:\n${JSON.stringify(body.context ?? null).slice(0, 8000)}`,
      reasoningEffort: 'low',
      maxOutputTokens: 1500,
      textFormat: ITEMS_SCHEMA,
      timeoutMs: 30_000,
      fetchImpl: opts.fetchImpl,
    });
    if (!result.ok) {
      console.error(`[item-build] OpenAI request failed${result.status !== undefined ? ` (${result.status})` : ''} — check the API key/quota.`);
      return reply.code(502).send(
        result.status !== undefined ? { error: 'upstream', status: result.status } : { error: 'upstream' },
      );
    }
    return reply.code(200).send({ items: parseItems(result.text) });
  });
}
