import type { FastifyInstance } from 'fastify';
import { writeFile, mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export interface RecordingRouteOptions {
  /** Fallback folder when the client hasn't configured a raw-data path. */
  defaultDir: string;
  allowOrigin?: string;
}

const DEFAULT_ALLOW_ORIGINS = ['http://127.0.0.1:5273', 'http://localhost:5273'];

// Keep filenames to a boring, path-traversal-proof charset. The client proposes a
// name (neurofocus-dota-<iso>.json); we sanitize and force the .json extension.
function safeFilename(name: unknown): string {
  const base = typeof name === 'string' ? name.replace(/[^A-Za-z0-9._-]/g, '') : '';
  const cleaned = base.replace(/^\.+/, '') || `neurofocus-dota-${Date.now()}`;
  return cleaned.toLowerCase().endsWith('.json') ? cleaned : `${cleaned}.json`;
}

/**
 * Persists a manually-recorded EEG session to disk. The overlay is a browser page
 * and can't write local files, so it POSTs the whole session (raw ADS1220 counts +
 * the 1 Hz focus timeline + kill/death events) here; the listener runs in Node and
 * writes it to the user's configured folder (or a default). Recording is a manual
 * Start/Stop act because Dota match boundaries aren't reliably detectable from GSI.
 */
export function registerRecordingRoute(app: FastifyInstance, opts: RecordingRouteOptions): void {
  const allowList = opts.allowOrigin
    ? opts.allowOrigin.split(',').map((s) => s.trim()).filter((s) => s !== '')
    : DEFAULT_ALLOW_ORIGINS;
  const primaryOrigin = allowList[0] ?? DEFAULT_ALLOW_ORIGINS[0]!;
  const resolveOrigin = (origin: unknown): string =>
    typeof origin === 'string' && allowList.includes(origin) ? origin : primaryOrigin;

  app.options('/recording', async (req, reply) =>
    reply.code(204)
      .header('access-control-allow-origin', resolveOrigin(req.headers.origin))
      .header('access-control-allow-methods', 'POST')
      .header('access-control-allow-headers', 'content-type')
      .header('vary', 'origin')
      .send());

  app.post('/recording', async (req, reply) => {
    reply.header('access-control-allow-origin', resolveOrigin(req.headers.origin)).header('vary', 'origin');
    const raw = req.body;
    const body = (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
      ? (raw as { dir?: unknown; filename?: unknown; session?: unknown })
      : {};
    if (body.session == null) {
      return reply.code(400).send({ error: 'no-session' });
    }

    // Only honour an absolute client path; otherwise fall back to the default dir.
    const dir = typeof body.dir === 'string' && body.dir.trim() !== '' && isAbsolute(body.dir.trim())
      ? body.dir.trim()
      : opts.defaultDir;
    const file = join(dir, safeFilename(body.filename));

    try {
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify(body.session), 'utf8');
      return reply.code(200).send({ ok: true, file });
    } catch (err) {
      return reply.code(500).send({ error: 'write-failed', detail: String(err instanceof Error ? err.message : err) });
    }
  });
}
