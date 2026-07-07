import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { isAuthorized, normalizeGsi, type GsiPayload } from '@dc/shared';
import { registerCoachRoute } from './coach-route';
import { registerItemRoute } from './item-route';
import { registerVisionRoute } from './vision-route';
import { registerSettingsRoute } from './settings-route';
import { registerRecordingRoute } from './recording-route';
import { registerVideoRoute } from './video-route';
import { registerOpenDotaRoute } from './opendota-route';
import { registerAnalysisRoute } from './analysis-route';
import type { Hub } from './hub';

export interface ServerOptions {
  token: string;
  hub: Hub;
  openaiKey?: string | null;
  coachAllowOrigin?: string;
  /** Persist a key set via /settings (e.g. the desktop app writes openai-key.txt). */
  onSaveOpenAiKey?: (key: string) => void;
  /** App version shown in the overlay (desktop passes app.getVersion()). */
  version?: string;
  /** Live auto-updater state + manual check trigger (desktop only). */
  updaterStatus?: () => { state: string; info: string | null };
  checkUpdates?: () => void;
  /** Fallback folder for saved EEG recordings when the client hasn't set a path. */
  recordingsDir?: string;
  /** When set, the built overlay is served from this dir so the app is one process. */
  staticDir?: string;
}

export function buildServer(opts: ServerOptions): FastifyInstance {
  // 64 MB: a long manual EEG recording POSTs raw ADS1220 counts as JSON (up to ~2 M
  // samples). Screenshots on POST /vision are far smaller; GSI payloads are tiny.
  const app = Fastify({ logger: false, bodyLimit: 64_000_000 });
  app.register(websocket);

  app.get('/health', async () => ({ ok: true }));

  // The OpenAI key can be set at runtime via /settings; hold it mutably and hand
  // the routes a live getter so a first-time setup doesn't need a restart.
  let currentKey: string | null = opts.openaiKey ?? null;
  const getApiKey = (): string | null => currentKey;

  registerCoachRoute(app, { apiKey: null, getApiKey, allowOrigin: opts.coachAllowOrigin });
  registerItemRoute(app, { apiKey: null, getApiKey, allowOrigin: opts.coachAllowOrigin });
  registerVisionRoute(app, { apiKey: null, getApiKey, allowOrigin: opts.coachAllowOrigin });
  registerAnalysisRoute(app, { apiKey: null, getApiKey, allowOrigin: opts.coachAllowOrigin });
  registerSettingsRoute(app, {
    getStatus: () => ({
      openaiKeySet: !!currentKey,
      version: opts.version ?? null,
      updater: opts.updaterStatus?.() ?? null,
    }),
    checkUpdates: opts.checkUpdates,
    setOpenAiKey: (key) => {
      currentKey = key.trim() === '' ? null : key.trim();
      if (currentKey && opts.onSaveOpenAiKey) opts.onSaveOpenAiKey(currentKey);
    },
    allowOrigin: opts.coachAllowOrigin,
  });
  const recordingsDir = opts.recordingsDir ?? join(process.cwd(), 'nf-recordings');
  registerRecordingRoute(app, { defaultDir: recordingsDir, allowOrigin: opts.coachAllowOrigin });
  registerVideoRoute(app, { defaultDir: recordingsDir, allowOrigin: opts.coachAllowOrigin });
  registerOpenDotaRoute(app, { cacheDir: recordingsDir, allowOrigin: opts.coachAllowOrigin });

  app.post('/', async (req, reply) => {
    const raw = req.body;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return reply.code(400).send();
    }
    const body = raw as GsiPayload;
    if (!isAuthorized(body, opts.token)) {
      return reply.code(401).send();
    }
    opts.hub.update(normalizeGsi(body));
    return reply.code(200).send();
  });

  app.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (socket) => {
      const latest = opts.hub.getLatest();
      if (latest) socket.send(JSON.stringify(latest));
      const off = opts.hub.subscribe((state) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(state));
      });
      socket.on('close', off);
    });
  });

  // Serve the built overlay so the whole app is one process on one port. The
  // explicit API routes above (POST /, GET /health, GET /ws) win over the static
  // handler; GET / and /assets/* fall through to the built files.
  if (opts.staticDir) {
    app.register(fastifyStatic, { root: opts.staticDir });
  }

  return app;
}
