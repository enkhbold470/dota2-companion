import type { FastifyInstance } from 'fastify';

export interface SettingsRouteOptions {
  /** Current status, read live. */
  getStatus: () => {
    openaiKeySet: boolean;
    /** App version (desktop passes app.getVersion(); absent in bare dev). */
    version?: string | null;
    /** Auto-updater state, e.g. { state: 'downloading', info: '42%' }. */
    updater?: { state: string; info: string | null } | null;
  };
  /** Persist + hot-swap a new OpenAI key. Empty string clears it. */
  setOpenAiKey: (key: string) => void;
  /** Trigger an update check (desktop only — absent means 501). */
  checkUpdates?: () => void;
  allowOrigin?: string;
}

const DEFAULT_ALLOW_ORIGINS = ['http://127.0.0.1:5273', 'http://localhost:5273'];

// A sane OpenAI key looks like sk-... / sk-proj-... — reject obvious junk so we
// don't persist a typo, but stay permissive about the exact format.
const KEY_RE = /^sk-[A-Za-z0-9_-]{20,}$/;

/**
 * Local settings surface for the first-time setup flow. `GET /settings` reports
 * whether AI is configured (never returns the key); `POST /settings/openai-key`
 * saves a key so AI features light up without editing files or restarting.
 */
export function registerSettingsRoute(app: FastifyInstance, opts: SettingsRouteOptions): void {
  const allowList = opts.allowOrigin
    ? opts.allowOrigin.split(',').map((s) => s.trim()).filter((s) => s !== '')
    : DEFAULT_ALLOW_ORIGINS;
  const primaryOrigin = allowList[0] ?? DEFAULT_ALLOW_ORIGINS[0]!;
  const resolveOrigin = (origin: unknown): string =>
    typeof origin === 'string' && allowList.includes(origin) ? origin : primaryOrigin;

  const cors = (req: { headers: Record<string, unknown> }, reply: {
    header: (k: string, v: string) => unknown;
  }): void => {
    reply.header('access-control-allow-origin', resolveOrigin(req.headers.origin));
    reply.header('vary', 'origin');
  };

  app.options('/settings/openai-key', async (req, reply) =>
    reply.code(204)
      .header('access-control-allow-origin', resolveOrigin(req.headers.origin))
      .header('access-control-allow-methods', 'POST')
      .header('access-control-allow-headers', 'content-type')
      .header('vary', 'origin')
      .send());

  app.get('/settings', async (req, reply) => {
    cors(req, reply);
    return reply.code(200).send(opts.getStatus());
  });

  app.options('/settings/check-updates', async (req, reply) =>
    reply.code(204)
      .header('access-control-allow-origin', resolveOrigin(req.headers.origin))
      .header('access-control-allow-methods', 'POST')
      .header('access-control-allow-headers', 'content-type')
      .header('vary', 'origin')
      .send());

  // Manual update check — the updater's result lands in GET /settings `updater`,
  // so failures are visible in the UI instead of dying in a console nobody sees.
  app.post('/settings/check-updates', async (req, reply) => {
    cors(req, reply);
    if (!opts.checkUpdates) return reply.code(501).send({ error: 'not-desktop' });
    opts.checkUpdates();
    return reply.code(200).send({ ok: true });
  });

  app.post('/settings/openai-key', async (req, reply) => {
    cors(req, reply);
    const raw = req.body;
    const body = (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
      ? (raw as { key?: unknown })
      : {};
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (key !== '' && !KEY_RE.test(key)) {
      return reply.code(400).send({ error: 'bad-key' });
    }
    opts.setOpenAiKey(key);
    return reply.code(200).send({ openaiKeySet: key !== '' });
  });
}
