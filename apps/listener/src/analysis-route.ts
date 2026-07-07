import type { FastifyInstance } from 'fastify';
import { ANALYSIS_CONTEXT_MAX_CHARS } from '@dc/shared';
import { callOpenAi, type TextFormat } from './openai';

/**
 * NeuroFocus Intelligence deep analysis: one explicit-button LLM call over a
 * recorded session's FlowState buckets + match events (context built client-side
 * by @dc/shared buildAnalysisContext). Returns focus-loss moments stamped with
 * the game clock so the review UI can seek the screen recording to each one.
 */

export interface AnalysisRouteOptions {
  apiKey: string | null;
  getApiKey?: () => string | null;
  model?: string;
  fetchImpl?: typeof fetch;
  allowOrigin?: string;
}

const DEFAULT_ALLOW_ORIGINS = ['http://127.0.0.1:5273', 'http://localhost:5273'];

const SYSTEM_PROMPT =
  'You are NeuroFocus Intelligence, a performance psychologist for competitive Dota 2. You receive an EEG-derived FlowState record of one match: ' +
  '15-second focus/stress buckets (0-100, 50 = the player\'s own baseline), a tilt score (0-5), the match event log (kills, deaths, level-ups, battles, day/night), ' +
  'aggregate stats with a heuristic "crash" candidate, and sometimes the team gold advantage curve. ' +
  'Diagnose WHERE and WHY the player lost focus: tie each dip to what was happening in the game (a death streak, a long dead-time, night, a gold slide), ' +
  'distinguish tilt (stress up, focus down after setbacks) from drift (slow decay without triggers), and credit strong recoveries. ' +
  'Speak to the player directly, concrete and kind — a coach, not a lab report. Times are game-clock seconds; reference them precisely in `t` fields ' +
  'and as mm:ss in prose. 3 to 6 moments, most damaging first. The recommendation is ONE specific, trainable habit for the next session.';

const ANALYSIS_SCHEMA: TextFormat = {
  type: 'json_schema',
  name: 'focus_analysis',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '2-4 sentence read of the whole session' },
      moments: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            t: { type: 'number', description: 'game-clock seconds of the moment' },
            title: { type: 'string', description: 'short label, e.g. "Post-death tilt spiral"' },
            insight: { type: 'string', description: '1-3 sentences: what happened and why it cost focus' },
          },
          required: ['t', 'title', 'insight'],
          additionalProperties: false,
        },
      },
      tiltPattern: { type: 'string', description: 'the player\'s tilt signature across the session' },
      recommendation: { type: 'string', description: 'one trainable habit for next session' },
    },
    required: ['summary', 'moments', 'tiltPattern', 'recommendation'],
    additionalProperties: false,
  },
};

export function registerAnalysisRoute(app: FastifyInstance, opts: AnalysisRouteOptions): void {
  const allowList = opts.allowOrigin
    ? opts.allowOrigin.split(',').map((s) => s.trim()).filter((s) => s !== '')
    : DEFAULT_ALLOW_ORIGINS;
  const primaryOrigin = allowList[0] ?? DEFAULT_ALLOW_ORIGINS[0]!;
  const resolveOrigin = (origin: unknown): string =>
    typeof origin === 'string' && allowList.includes(origin) ? origin : primaryOrigin;

  app.options('/analysis', async (req, reply) => {
    return reply
      .code(204)
      .header('access-control-allow-origin', resolveOrigin(req.headers.origin))
      .header('access-control-allow-methods', 'POST')
      .header('access-control-allow-headers', 'content-type')
      .header('vary', 'origin')
      .send();
  });

  app.post('/analysis', async (req, reply) => {
    reply.header('access-control-allow-origin', resolveOrigin(req.headers.origin));
    reply.header('vary', 'origin');

    const raw = req.body;
    const body = (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
      ? (raw as { context?: unknown })
      : {};
    if (typeof body.context !== 'object' || body.context === null) {
      return reply.code(400).send({ error: 'bad-context' });
    }
    const apiKey = opts.getApiKey ? opts.getApiKey() : opts.apiKey;
    if (!apiKey) {
      return reply.code(501).send({ error: 'no-key' });
    }

    const result = await callOpenAi({
      apiKey,
      model: opts.model,
      instructions: SYSTEM_PROMPT,
      input: `Session record:\n${JSON.stringify(body.context).slice(0, ANALYSIS_CONTEXT_MAX_CHARS)}`,
      reasoningEffort: 'medium',
      maxOutputTokens: 4000,
      textFormat: ANALYSIS_SCHEMA,
      timeoutMs: 45_000,
      fetchImpl: opts.fetchImpl,
    });
    if (!result.ok) {
      console.error(`[analysis] OpenAI request failed${result.status !== undefined ? ` (${result.status})` : ''} — check the API key/quota.`);
      return reply.code(502).send(
        result.status !== undefined ? { error: 'upstream', status: result.status } : { error: 'upstream' },
      );
    }
    try {
      return reply.code(200).send(JSON.parse(result.text));
    } catch {
      return reply.code(502).send({ error: 'upstream' });
    }
  });
}
