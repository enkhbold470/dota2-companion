import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { isAuthorized, normalizeGsi, type GsiPayload } from '@dc/shared';
import { registerCoachRoute } from './coach-route';
import { registerItemRoute } from './item-route';
import { registerVisionRoute } from './vision-route';
import type { Hub } from './hub';

export interface ServerOptions {
  token: string;
  hub: Hub;
  openaiKey?: string | null;
  coachAllowOrigin?: string;
  /** When set, the built overlay is served from this dir so the app is one process. */
  staticDir?: string;
}

export function buildServer(opts: ServerOptions): FastifyInstance {
  // 8 MB to accommodate pasted screenshots on POST /vision (GSI payloads are tiny).
  const app = Fastify({ logger: false, bodyLimit: 8_000_000 });
  app.register(websocket);

  app.get('/health', async () => ({ ok: true }));

  registerCoachRoute(app, { apiKey: opts.openaiKey ?? null, allowOrigin: opts.coachAllowOrigin });
  registerItemRoute(app, { apiKey: opts.openaiKey ?? null, allowOrigin: opts.coachAllowOrigin });
  registerVisionRoute(app, { apiKey: opts.openaiKey ?? null, allowOrigin: opts.coachAllowOrigin });

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
