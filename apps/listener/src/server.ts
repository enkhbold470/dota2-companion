import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { isAuthorized, normalizeGsi, type GsiPayload } from '@dc/shared';
import { registerCoachRoute } from './coach-route';
import type { Hub } from './hub';

export interface ServerOptions {
  token: string;
  hub: Hub;
  openaiKey?: string | null;
  coachAllowOrigin?: string;
}

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  app.register(websocket);

  app.get('/health', async () => ({ ok: true }));

  registerCoachRoute(app, { apiKey: opts.openaiKey ?? null, allowOrigin: opts.coachAllowOrigin });

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

  return app;
}
