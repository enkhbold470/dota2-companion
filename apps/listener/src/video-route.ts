import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, open, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { parseSessionHead, type SessionHead } from '@dc/shared';

export interface VideoRouteOptions {
  /** Fallback folder when the client hasn't configured a raw-data path. */
  defaultDir: string;
  allowOrigin?: string;
}

const DEFAULT_ALLOW_ORIGINS = ['http://127.0.0.1:5273', 'http://localhost:5273'];

// One boring path segment, .json or .webm only. No slashes and no leading dot can
// pass, so join(dir, name) can never escape the target folder.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(json|webm)$/;

function safeName(name: unknown): string | null {
  return typeof name === 'string' && NAME_RE.test(name) ? name : null;
}

// Same trust model as the recording route: only an absolute client path is
// honoured (it's the user's own "raw EEG data folder" setting), else the default.
function resolveDir(dir: unknown, fallback: string): string {
  return typeof dir === 'string' && dir.trim() !== '' && isAbsolute(dir.trim())
    ? dir.trim()
    : fallback;
}

/** Listing metadata read from just the head of a session file (never the ~MBs of samples). */
async function readHead(file: string): Promise<SessionHead> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return parseSessionHead(buf.toString('utf8', 0, bytesRead));
  } finally {
    await fh.close();
  }
}

/**
 * Screen-recording persistence + read-back for the focus review UI. The overlay
 * (a browser page) can't touch the filesystem, so while recording it streams
 * MediaRecorder chunks here (POST /video/start → /video/chunk… → /video/finish)
 * and the listener appends them to a .webm next to the session JSON. Read-back
 * is GET /recordings (listing with session-head metadata) and GET
 * /recordings/file (Range-capable, so the <video> element can seek). Everything
 * stays on this machine — the listener binds 127.0.0.1 only.
 */
export function registerVideoRoute(app: FastifyInstance, opts: VideoRouteOptions): void {
  const allowList = opts.allowOrigin
    ? opts.allowOrigin.split(',').map((s) => s.trim()).filter((s) => s !== '')
    : DEFAULT_ALLOW_ORIGINS;
  const primaryOrigin = allowList[0] ?? DEFAULT_ALLOW_ORIGINS[0]!;
  const resolveOrigin = (origin: unknown): string =>
    typeof origin === 'string' && allowList.includes(origin) ? origin : primaryOrigin;
  const cors = (req: { headers: { origin?: unknown } }, reply: { header(k: string, v: string): unknown }) => {
    reply.header('access-control-allow-origin', resolveOrigin(req.headers.origin));
    reply.header('vary', 'origin');
  };

  // MediaRecorder chunks arrive as raw bytes.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' },
    (_req, body, done) => done(null, body));

  for (const url of ['/video/start', '/video/chunk', '/video/finish']) {
    app.options(url, async (req, reply) =>
      reply.code(204)
        .header('access-control-allow-origin', resolveOrigin(req.headers.origin))
        .header('access-control-allow-methods', 'POST')
        .header('access-control-allow-headers', 'content-type')
        .header('vary', 'origin')
        .send());
  }

  app.post('/video/start', async (req, reply) => {
    cors(req, reply);
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as
      { dir?: unknown; filename?: unknown };
    const name = safeName(body.filename);
    if (!name || !name.endsWith('.webm')) return reply.code(400).send({ error: 'bad-filename' });
    const dir = resolveDir(body.dir, opts.defaultDir);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), Buffer.alloc(0)); // create/truncate
      return reply.code(200).send({ ok: true, file: join(dir, name), name });
    } catch (err) {
      return reply.code(500).send({ error: 'write-failed', detail: String(err instanceof Error ? err.message : err) });
    }
  });

  app.post('/video/chunk', async (req, reply) => {
    cors(req, reply);
    const q = req.query as { name?: unknown; dir?: unknown };
    const name = safeName(q.name);
    if (!name || !name.endsWith('.webm')) return reply.code(400).send({ error: 'bad-filename' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return reply.code(400).send({ error: 'no-bytes' });
    }
    const dir = resolveDir(q.dir, opts.defaultDir);
    try {
      await appendFile(join(dir, name), req.body);
      return reply.code(200).send({ ok: true, bytes: req.body.length });
    } catch (err) {
      return reply.code(500).send({ error: 'write-failed', detail: String(err instanceof Error ? err.message : err) });
    }
  });

  app.post('/video/finish', async (req, reply) => {
    cors(req, reply);
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as
      { dir?: unknown; name?: unknown };
    const name = safeName(body.name);
    if (!name) return reply.code(400).send({ error: 'bad-filename' });
    const dir = resolveDir(body.dir, opts.defaultDir);
    try {
      const st = await stat(join(dir, name));
      return reply.code(200).send({ ok: true, bytes: st.size });
    } catch {
      return reply.code(404).send({ error: 'not-found' });
    }
  });

  app.get('/recordings', async (req, reply) => {
    cors(req, reply);
    const q = req.query as { dir?: unknown };
    const dir = resolveDir(q.dir, opts.defaultDir);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return reply.code(200).send({ dir, sessions: [], videos: [] }); // no folder yet = nothing recorded
    }
    const sessions = [];
    const videos = [];
    for (const name of names) {
      if (!safeName(name)) continue;
      const file = join(dir, name);
      let st;
      try { st = await stat(file); } catch { continue; }
      if (!st.isFile()) continue;
      if (name.endsWith('.webm')) {
        videos.push({ name, size: st.size, mtimeMs: st.mtimeMs });
      } else {
        let head: SessionHead | null = null;
        try { head = await readHead(file); } catch { /* unreadable — list it bare */ }
        if (head && head.format === null) head = null; // not a session file
        sessions.push({ name, size: st.size, mtimeMs: st.mtimeMs, head });
      }
    }
    sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return reply.code(200).send({ dir, sessions, videos });
  });

  app.get('/recordings/file', async (req, reply) => {
    cors(req, reply);
    const q = req.query as { name?: unknown; dir?: unknown };
    const name = safeName(q.name);
    if (!name) return reply.code(400).send({ error: 'bad-filename' });
    const dir = resolveDir(q.dir, opts.defaultDir);
    const file = join(dir, name);
    let st;
    try { st = await stat(file); } catch { return reply.code(404).send({ error: 'not-found' }); }
    const type = name.endsWith('.webm') ? 'video/webm' : 'application/json';
    reply.header('accept-ranges', 'bytes');

    // Minimal single-range support so the <video> element can seek.
    const m = typeof req.headers.range === 'string'
      ? req.headers.range.match(/^bytes=(\d*)-(\d*)$/)
      : null;
    if (m && (m[1] !== '' || m[2] !== '')) {
      const start = m[1] === '' ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
      const end = Math.min(m[1] !== '' && m[2] !== '' ? Number(m[2]) : st.size - 1, st.size - 1);
      if (start > end || start >= st.size) {
        return reply.code(416).header('content-range', `bytes */${st.size}`).send();
      }
      return reply.code(206)
        .header('content-range', `bytes ${start}-${end}/${st.size}`)
        .header('content-length', String(end - start + 1))
        .type(type)
        .send(createReadStream(file, { start, end }));
    }
    return reply.header('content-length', String(st.size)).type(type).send(createReadStream(file));
  });
}
