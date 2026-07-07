import type { FastifyInstance } from 'fastify';
import { callOpenAi, type TextFormat } from './openai';

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

// Draft mode: read ALL ten heroes and split them by side, so the client can map
// allies vs enemies using which team it is (from GSI). Radiant sits left of the
// central clock/score in the top bar, Dire right. The client sends a cropped
// strip of the top hero bar (not the full screen).
const DRAFT_SYSTEM_PROMPT =
  'You read a cropped strip of the Dota 2 top hero bar (or a scoreboard screenshot) and list every hero, split by team. ' +
  'The top bar shows up to 5 Radiant hero portraits on the LEFT of the central clock/score and up to 5 Dire portraits on the RIGHT ' +
  '(on a scoreboard, Radiant is the green group, Dire the red group). ' +
  'Use exact official English names, e.g. "Anti-Mage", "Queen of Pain", "Nature\'s Prophet", "Outworld Destroyer". ' +
  'At most 5 per team, each once, only heroes you can clearly identify. Unseen side → empty array.';

const DRAFT_SCHEMA: TextFormat = {
  type: 'json_schema',
  name: 'draft_sides',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      radiant: { type: 'array', items: { type: 'string' }, maxItems: 5 },
      dire: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    },
    required: ['radiant', 'dire'],
    additionalProperties: false,
  },
};

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

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 5) : [];
}

function parseDraft(content: unknown): { radiant: string[]; dire: string[] } {
  if (typeof content !== 'string') return { radiant: [], dire: [] };
  try {
    const obj = JSON.parse(content) as { radiant?: unknown; dire?: unknown };
    return { radiant: strArray(obj?.radiant), dire: strArray(obj?.dire) };
  } catch {
    return { radiant: [], dire: [] };
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
      ? (raw as { image?: unknown; ownHero?: unknown; mode?: unknown })
      : {};
    const image = body.image;
    if (typeof image !== 'string' || !image.startsWith('data:image/') || image.length > MAX_IMAGE_CHARS) {
      return reply.code(400).send({ error: 'bad-image' });
    }
    const apiKey = opts.getApiKey ? opts.getApiKey() : opts.apiKey;
    if (!apiKey) {
      return reply.code(501).send({ error: 'no-key' });
    }
    const draftMode = body.mode === 'draft';
    const ownHero = typeof body.ownHero === 'string' && body.ownHero.trim() !== '' ? body.ownHero.trim() : null;

    const result = await callOpenAi({
      apiKey,
      model: opts.model,
      instructions: draftMode ? DRAFT_SYSTEM_PROMPT : SYSTEM_PROMPT,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: draftMode
              ? 'List every hero in the top bar / scoreboard, split into radiant (left) and dire (right).'
              : userInstruction(ownHero) },
            // 'original' keeps the hero-bar strip at full fidelity — the
            // portraits are small and spatially ordered, exactly what the
            // downscaled tiling modes lose.
            { type: 'input_image', image_url: image, detail: 'original' },
          ],
        },
      ],
      reasoningEffort: 'low',
      maxOutputTokens: 1200,
      textFormat: draftMode ? DRAFT_SCHEMA : { type: 'json_object' },
      timeoutMs: 35_000,
      fetchImpl: opts.fetchImpl,
    });
    if (!result.ok) {
      console.error(`[vision] OpenAI request failed${result.status !== undefined ? ` (${result.status})` : ''} — check the API key/quota.`);
      return reply.code(502).send(
        result.status !== undefined ? { error: 'upstream', status: result.status } : { error: 'upstream' },
      );
    }
    if (draftMode) return reply.code(200).send(parseDraft(result.text));
    return reply.code(200).send({ heroes: parseHeroes(result.text) });
  });
}
